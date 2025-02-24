import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export function createCoreInfra(cfg: pulumi.Config) {
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

    return {
        githubActionsRole,
    };
}
