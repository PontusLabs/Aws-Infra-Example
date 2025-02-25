import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

export function createDatabase(project: string, stack: string, cfg: pulumi.Config, vpc: awsx.ec2.Vpc, internalSg: aws.ec2.SecurityGroup) {
    const redisSubnetGroup = new aws.elasticache.SubnetGroup(`${stack}-redis-subnet-group`, {
        subnetIds: vpc.privateSubnetIds,
    });

    const redisCluster = new aws.elasticache.Cluster(`${stack}-redis-cluster`, {
        engine: "redis",
        nodeType: "cache.t3.micro",
        numCacheNodes: 1,
        port: 6379,
        subnetGroupName: redisSubnetGroup.name,
        securityGroupIds: [internalSg.id],
    });

    // RDS PostgreSQL instance
    const dbSubnetGroup = new aws.rds.SubnetGroup(`${stack}-db-subnet-group`, {
        subnetIds: vpc.privateSubnetIds,
    });

    const dbInstance = new aws.rds.Instance(`${stack}-postgres-db`, {
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
    const rabbitMqBroker = new aws.mq.Broker(`${stack}-rabbitmq-broker`, {
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
    return { dbInstance, rabbitMqBroker, redisCluster };
}
