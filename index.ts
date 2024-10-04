import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { getConnectionDetails } from "./helper";

// Project configuration
const project = "pontus";
const stack = "dev";
const cfg = new pulumi.Config();
const domain = cfg.require("DOMAIN");

// AWS provider configuration
const awsProvider = new aws.Provider("aws-provider", {
  region: "us-east-1", // us-east-1 is required for Bedrock
});

// VPC configuration
const vpc = new awsx.ec2.Vpc("main-vpc", {
  cidrBlock: "10.0.0.0/16",
  numberOfAvailabilityZones: 2,
  natGateways: { strategy: "Single" },
  enableDnsHostnames: true,
  enableDnsSupport: true,
});

// VPC DNS settings
const vpcDnsSettings = new aws.ec2.VpcDhcpOptions("vpc-dns-settings", {
  domainNameServers: ["AmazonProvidedDNS"],
});

new aws.ec2.VpcDhcpOptionsAssociation("vpc-dns-association", {
  vpcId: vpc.vpcId,
  dhcpOptionsId: vpcDnsSettings.id,
});

// Security Groups
const lbSg = new aws.ec2.SecurityGroup("lb-sg", {
  vpcId: vpc.vpcId,
  ingress: [
    { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
    { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
});

const internalSg = new aws.ec2.SecurityGroup("internal-sg", {
  vpcId: vpc.vpcId,
  ingress: [
    { protocol: "-1", fromPort: 0, toPort: 0, self: true },
    { protocol: "tcp", fromPort: 80, toPort: 80, securityGroups: [lbSg.id] },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
  tags: { Name: "allow-internal-and-outbound" },
});

// VPC Endpoints
const vpcEndpoints = [
  new aws.ec2.VpcEndpoint("ssm-endpoint", {
    vpcId: vpc.vpcId,
    serviceName: "com.amazonaws.us-east-2.ssm",
    vpcEndpointType: "Interface",
    privateDnsEnabled: true,
    subnetIds: vpc.privateSubnetIds,
    securityGroupIds: [internalSg.id],
  }),
  new aws.ec2.VpcEndpoint("ssmmessages-endpoint", {
    vpcId: vpc.vpcId,
    serviceName: "com.amazonaws.us-east-2.ssmmessages",
    vpcEndpointType: "Interface",
    privateDnsEnabled: true,
    subnetIds: vpc.privateSubnetIds,
    securityGroupIds: [internalSg.id],
  }),
  new aws.ec2.VpcEndpoint("ec2messages-endpoint", {
    vpcId: vpc.vpcId,
    serviceName: "com.amazonaws.us-east-2.ec2messages",
    vpcEndpointType: "Interface",
    privateDnsEnabled: true,
    subnetIds: vpc.privateSubnetIds,
    securityGroupIds: [internalSg.id],
  }),
];

// ElastiCache Redis cluster
const redisSubnetGroup = new aws.elasticache.SubnetGroup("redis-subnet-group", {
  subnetIds: vpc.privateSubnetIds,
});

const redisCluster = new aws.elasticache.Cluster("redis-cluster", {
  engine: "redis",
  nodeType: "cache.t3.micro",
  numCacheNodes: 1,
  port: 6379,
  subnetGroupName: redisSubnetGroup.name,
  securityGroupIds: [internalSg.id],
});

// RDS PostgreSQL instance
const dbSubnetGroup = new aws.rds.SubnetGroup("db-subnet-group", {
  subnetIds: vpc.privateSubnetIds,
});

const dbInstance = new aws.rds.Instance("postgres-db", {
  engine: "postgres",
  instanceClass: "db.t3.micro",
  allocatedStorage: 20,
  dbName: cfg.require("POSTGRES_DB"),
  username: cfg.require("POSTGRES_USER"),
  password: cfg.require("POSTGRES_PASSWORD"),
  skipFinalSnapshot: true,
  dbSubnetGroupName: dbSubnetGroup.name,
  vpcSecurityGroupIds: [internalSg.id],
});

// Amazon MQ (RabbitMQ) broker
const rabbitMqBroker = new aws.mq.Broker("rabbitmq-broker", {
  brokerName: `${project}-${stack}-rabbitmq-broker`,
  engineType: "RabbitMQ",
  engineVersion: "3.12.13",
  hostInstanceType: "mq.t3.micro",
  publiclyAccessible: false,
  securityGroups: [internalSg.id],
  subnetIds: [vpc.privateSubnetIds[0]],
  users: [
    {
      username: cfg.require("MQ_USER"),
      password: cfg.require("MQ_PASSWORD"),
    },
  ],
});

// Secrets Manager
const secretString = pulumi
  .all([
    dbInstance.endpoint,
    dbInstance.port,
    rabbitMqBroker.instances[0].endpoints[0],
    redisCluster.cacheNodes[0].address,
    redisCluster.cacheNodes[0].port,
  ])
  .apply(([dbEndpoint, dbPort, rabbitMqEndpoint, redisHost, redisPort]) =>
    JSON.stringify({
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
  policyArn:
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
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

// Exports
export const clusterName = cluster.name;
export const vpcId = vpc.vpcId;
export const privateSubnetIds = vpc.privateSubnetIds;
export const publicSubnetIds = vpc.publicSubnetIds;
export const internalSecurityGroupId = internalSg.id;
export const redisEndpoint = redisCluster.cacheNodes[0].address;
export const redisPort = redisCluster.port;
export const dbEndpoint = dbInstance.endpoint;
export const dbPort = dbInstance.port;
export const rabbitMqEndpoint = rabbitMqBroker.instances[0].endpoints[0];
export const secretsManagerArn = appSecrets.arn;
export const ecsClusterArn = cluster.arn;
export const ecsServiceName = service.service.name;
export const url = pulumi.interpolate`http://${loadbalancer.loadBalancer.dnsName}`;
export const apiUrl = pulumi.interpolate`https://api.${domain}`;
