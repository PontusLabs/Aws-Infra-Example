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

    const appSecrets = new aws.secretsmanager.Secret("app-secrets", {
        name: `${project}-${stack}-app-secrets-2`,
        description: "Pontus app secrets",
    });

    const secret = new aws.secretsmanager.SecretVersion(
        "pontus-secrets-version-2",
        {
            secretId: appSecrets.id,
            secretString: secretString,
        }
    );

    // SSL Certificate
    const rootZone = aws.route53.getZone({ name: domain }, { async: true });

    const apiCert = new aws.acm.Certificate("api-cert", {
        domainName: `api.${domain}`,
        validationMethod: "DNS",
    });

    const apiCertValidation = new aws.route53.Record("api-cert-validation", {
        name: apiCert.domainValidationOptions[0].resourceRecordName,
        zoneId: rootZone.then((zone) => zone.zoneId),
        type: apiCert.domainValidationOptions[0].resourceRecordType,
        records: [apiCert.domainValidationOptions[0].resourceRecordValue],
        ttl: 60,
    });

    const certificateValidation = new aws.acm.CertificateValidation(
        "certificate-validation",
        {
            certificateArn: apiCert.arn,
            validationRecordFqdns: [apiCertValidation.fqdn],
        }
    );

    // ECS Cluster and Load Balancer
    const cluster = new aws.ecs.Cluster("app-cluster");

    const loadbalancer = new awsx.lb.ApplicationLoadBalancer("loadbalancer", {
        securityGroups: [lbSg.id],
        subnetIds: vpc.publicSubnetIds,
        listeners: [
            {
                port: 443,
                protocol: "HTTPS",
                certificateArn: apiCert.arn,
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
    const taskRole = new aws.iam.Role("taskRole", {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
            Service: "ecs-tasks.amazonaws.com",
        }),
    });

    const taskRolePolicy = new aws.iam.RolePolicy("taskRolePolicy", {
        role: taskRole.id,
        policy: {
            Version: "2012-10-17",
            Statement: [
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
            ],
        },
    });

    new aws.iam.RolePolicyAttachment("taskRolePolicyAttachment", {
        role: taskRole.name,
        policyArn: "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess",
    });

    const executionRole = new aws.iam.Role("executionRole", {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
            Service: "ecs-tasks.amazonaws.com",
        }),
    });

    new aws.iam.RolePolicyAttachment("executionRolePolicyAttachment", {
        role: executionRole.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    });

    // ECS Service
    const service = new awsx.ecs.FargateService(
        "app-service",
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
                        { name: "TEST_VARIABLE", value: "Hello from ECS" },
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
    const apiRecord = new aws.route53.Record("api-record", {
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
    return { cluster, appSecrets, service, loadbalancer };
}

