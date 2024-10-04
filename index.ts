import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

import { createNetworking } from "./infra/networking";
import { createDatabase } from "./infra/databases";
import { createService } from "./infra/service";

// Project configuration
const project = "pontus";
const stack = pulumi.getStack();
const cfg = new pulumi.Config();
const domain = cfg.require("DOMAIN");

// AWS provider configuration
const awsProvider = new aws.Provider("aws-provider", {
  region: "us-east-1", // us-east-1 is required for all Bedrock endpoints
});

// VPC configuration
const { vpc, internalSg, lbSg, vpcEndpoints } = createNetworking();

// Database configuration
const { dbInstance, rabbitMqBroker, redisCluster } = createDatabase(project, stack, cfg, vpc, internalSg);

// Service configuration
const { cluster, appSecrets, service, loadbalancer } = createService(project, stack, cfg, vpc, internalSg, lbSg, dbInstance, rabbitMqBroker, redisCluster, vpcEndpoints);

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
