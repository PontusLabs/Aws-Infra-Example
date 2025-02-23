import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import { getConnectionDetails } from "./helper";

export function createService(
    project: string,
    stack: string,
    cfg: pulumi.Config,
    vpc: awsx.ec2.Vpc,
    internalSg: aws.ec2.SecurityGroup,
    lbSg: aws.ec2.SecurityGroup,
    dbInstance: aws.rds.Instance,
    rabbitMqBroker: aws.mq.Broker,
    redisCluster: aws.elasticache.Cluster,
    vpcEndpoints: aws.ec2.VpcEndpoint[]
) {
    const domain = cfg.require("DOMAIN");
    const secretString = pulumi
        .all([
            dbInstance.endpoint,
            dbInstance.port,
            rabbitMqBroker.instances[0].endpoints[0],
            redisCluster.cacheNodes[0].address,
            redisCluster.cacheNodes[0].port,
        ])
        .apply(([dbEndpoint, dbPort, rabbitMqEndpoint, redisHost, redisPort]) => JSON.stringify({
            AES_KEY: cfg.require("AES_KEY"),
            JWT_SECRET_KEY: cfg.require("JWT_SECRET_KEY"),
            DATABASE_HOST: getConnectionDetails(dbEndpoint, "postgres").host,
            DATABASE_PORT: getConnectionDetails(dbEndpoint, "postgres").port,
            DATABASE_NAME: cfg.require("POSTGRES_DB"),
            DATABASE_USER: cfg.require("POSTGRES_USER"),
            DATABASE_PASSWORD: cfg.require("POSTGRES_PASSWORD"),
            DATABASE_SSL_MODE: "require",
            RABBITMQ_USER: cfg.require("MQ_USER"),
            RABBITMQ_PASSWORD: cfg.require("MQ_PASSWORD"),
            RABBITMQ_HOST: getConnectionDetails(rabbitMqEndpoint, "rabbitmq").host,
            RABBITMQ_PORT: getConnectionDetails(rabbitMqEndpoint, "rabbitmq").port,
            REDIS_HOST: getConnectionDetails(redisHost, "redis").host,
            REDIS_PORT: getConnectionDetails(redisHost, "redis").port,
            LICENSE: cfg.require("LICENSE"),
            LLM_PROVIDER: "deepinfra",
            DEEPINFRA_API_KEY: cfg.require("DEEPINFRA_API_KEY"),
        })
        );

    const appSecrets = new aws.secretsmanager.Secret(`${stack}-app-secrets`, {
        name: `${project}-${stack}-app-secrets-2`,
        description: "Pontus app secrets",
    });

    const secret = new aws.secretsmanager.SecretVersion(
        `${stack}-pontus-secrets-version-2`,
        {
            secretId: appSecrets.id,
            secretString: secretString,
        }
    );

    // SSL Certificate
    const rootZone = aws.route53.getZone({ name: domain }, { async: true });

    const apiCert = new aws.acm.Certificate(`${stack}-api-cert`, {
        domainName: `api.${domain}`,
        validationMethod: "DNS",
    });

    const apiCertValidation = new aws.route53.Record(`${stack}-api-cert-validation`, {
        name: apiCert.domainValidationOptions[0].resourceRecordName,
        zoneId: rootZone.then((zone) => zone.zoneId),
        type: apiCert.domainValidationOptions[0].resourceRecordType,
        records: [apiCert.domainValidationOptions[0].resourceRecordValue],
        ttl: 60,
    });

    const certificateValidation = new aws.acm.CertificateValidation(
        `${stack}-certificate-validation`,
        {
            certificateArn: apiCert.arn,
            validationRecordFqdns: [apiCertValidation.fqdn],
        }
    );

    // ECS Cluster and Load Balancer
    const cluster = new aws.ecs.Cluster(`${stack}-app-cluster`);

    const loadbalancer = new awsx.lb.ApplicationLoadBalancer(`${stack}-loadbalancer`, {
        securityGroups: [lbSg.id],
        subnetIds: vpc.publicSubnetIds,
        listeners: [
            {
                port: 443,
                protocol: "HTTPS",
                certificateArn: certificateValidation.certificateArn,
            },
        ],
        defaultTargetGroup: {
            vpcId: vpc.vpcId,
            healthCheck: { path: "/health" },
            protocol: "HTTP",
            port: 80,
        },
    });

    // IAM Roles and Policies
    const taskRole = new aws.iam.Role(`${stack}-taskRole`, {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
            Service: "ecs-tasks.amazonaws.com",
        }),
    });

    const taskRolePolicy = new aws.iam.RolePolicy(`${stack}-taskRolePolicy`, {
        role: taskRole.id,
        policy: {
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "s3:ListBucket",
                        "s3:GetObject",
                        "s3:PutObject",
                        "s3:DeleteObject"
                    ],
                    Resource: [
                        "*"
                    ]
                },
                {
                    Effect: "Allow",
                    Action: [
                        "ssmmessages:CreateControlChannel",
                        "ssmmessages:CreateDataChannel",
                        "ssmmessages:OpenControlChannel",
                        "ssmmessages:OpenDataChannel",
                        "ssm:UpdateInstanceInformation",
                    ],
                    Resource: "*",
                },
                {
                    Effect: "Allow",
                    Action: [
                        "logs:CreateLogStream",
                        "logs:DescribeLogGroups",
                        "logs:DescribeLogStreams",
                        "logs:PutLogEvents",
                    ],
                    Resource: "*",
                },
                {
                    Effect: "Allow",
                    Action: [
                        "secretsmanager:GetSecretValue",
                        "secretsmanager:DescribeSecret",
                    ],
                    Resource: appSecrets.arn,
                },
                {
                    Effect: "Allow",
                    Action: [
                        "bedrock:InvokeModel",
                        "bedrock:InvokeModelWithResponseStream"
                    ],
                    Resource: "*"
                },
            ],
        },
    });

    new aws.iam.RolePolicyAttachment(`${stack}-taskRolePolicyAttachment`, {
        role: taskRole.name,
        policyArn: "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess",
    });

    const executionRole = new aws.iam.Role(`${stack}-executionRole`, {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
            Service: "ecs-tasks.amazonaws.com",
        }),
    });

    new aws.iam.RolePolicyAttachment(`${stack}-executionRolePolicyAttachment`, {
        role: executionRole.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    });

    // Add GitHub OIDC Provider and Role
    const githubOidcProvider = new aws.iam.OpenIdConnectProvider("github-oidc-provider", {
        url: "https://token.actions.githubusercontent.com",
        clientIdLists: ["sts.amazonaws.com"],
        thumbprintLists: ["6938fd4d98bab03faadb97b34396831e3780aea1"],
    });

    const trustPolicyDocument = pulumi.output(githubOidcProvider.arn).apply(providerArn => ({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: "sts:AssumeRoleWithWebIdentity",
            Principal: {
                Federated: providerArn,
            },
            Condition: {
                StringEquals: {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                },
                StringLike: {
                    "token.actions.githubusercontent.com:sub": `repo:${cfg.require("GITHUB_REPO")}:*`,
                },
            },
        }],
    }));

    const githubActionsRole = new aws.iam.Role("github-actions-role", {
        name: `github-actions-ecs-deploy-role`,
        assumeRolePolicy: trustPolicyDocument.apply(doc => JSON.stringify(doc)),
        description: "Role for GitHub Actions to update ECS services",
    });

    const ecsUpdatePolicy = new aws.iam.Policy("ecs-update-policy", {
        name: `EcsServiceUpdatePolicy`,
        description: "Allows updating ECS services",
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "ecs:ListClusters",
                        "ecs:ListServices",
                        "ecs:UpdateService",
                        "ecs:DescribeServices",
                        "ecs:DescribeTaskDefinition",
                        "ecs:RegisterTaskDefinition",
                        "ec2:DescribeRegions"
                    ],
                    Resource: "*",
                },
                {
                    Effect: "Allow",
                    Action: "iam:PassRole",
                    Resource: "*",
                    Condition: {
                        StringLike: {
                            "iam:PassedToService": "ecs-tasks.amazonaws.com"
                        }
                    }
                }
            ]
        })
    });

    new aws.iam.RolePolicyAttachment("ecs-policy-attachment", {
        role: githubActionsRole.name,
        policyArn: ecsUpdatePolicy.arn,
    });

    // ECS Service
    const service = new awsx.ecs.FargateService(
        `${stack}-app-service`,
        {
            cluster: cluster.arn,
            desiredCount: 1,
            networkConfiguration: {
                subnets: vpc.privateSubnetIds,
                securityGroups: [internalSg.id],
                assignPublicIp: true,
            },
            taskDefinitionArgs: {
                cpu: "1024",
                memory: "2048",
                taskRole: { roleArn: taskRole.arn },
                executionRole: { roleArn: executionRole.arn },
                container: {
                    name: "pontus-core",
                    image: "public.ecr.aws/g6m3b3n1/pontuslabs/core:latest",
                    essential: true,
                    healthCheck: {
                        command: [
                            "CMD-SHELL",
                            "wget -q --spider http://localhost:80/health || exit 1",
                        ],
                        interval: 30,
                        timeout: 5,
                        retries: 5,
                        startPeriod: 10,
                    },
                    portMappings: [
                        { containerPort: 80, targetGroup: loadbalancer.defaultTargetGroup },
                    ],
                    environment: [
                        { name: "AWS_REGION", value: cfg.require("AWS_REGION") },
                        { name: "STACK", value: stack },
                        { name: "BASE_URL", value: `https://api.${domain}` },
                    ],
                },
            },
            forceNewDeployment: true,
            enableExecuteCommand: true,
        },
        { dependsOn: [...vpcEndpoints] }
    );

    // Route53 Record
    const apiRecord = new aws.route53.Record(`${stack}-api-record`, {
        zoneId: rootZone.then((zone) => zone.zoneId),
        name: `api.${domain}`,
        type: "A",
        aliases: [
            {
                name: loadbalancer.loadBalancer.dnsName,
                zoneId: loadbalancer.loadBalancer.zoneId,
                evaluateTargetHealth: true,
            },
        ],
    });
    return { cluster, appSecrets, service, loadbalancer, githubActionsRole };
}

