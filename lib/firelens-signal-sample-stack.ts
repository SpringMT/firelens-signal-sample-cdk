import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns'
import { FirelensLogRouterType, NetworkMode } from 'aws-cdk-lib/aws-ecs'

export class FirelensSignalSampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'firelens-signal-sample-vpc', { maxAzs: 2});
    const cluster = new ecs.Cluster(this, 'log-sample-ecs', {
      vpc,
    })

    cluster.addCapacity('DefaultAutoScalingGroupCapacity', {
      instanceType: new ec2.InstanceType("t3.xlarge"),
      desiredCapacity: 1,
      keyName: 'springmt-test'
    })

    const executionRole = new iam.Role(this, 'FirelensSignalSampleEcsTaskExecutionRole', {
      roleName: 'firelens-signal-sample-ecs-task-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    })
    const serviceTaskRole = new iam.Role(this, 'FirelensSignalSampleEcsServiceTaskRole', {
      roleName: 'firelens-signal-sample-ecs-service-task-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    })
    
    serviceTaskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel',
      ],
      resources: ['*'],
    }))
    
    const taskDef = new ecs.FargateTaskDefinition(this, "LogSampleTaskDefinition", {
      family: 'firelens-signal-sample',
      memoryLimitMiB: 1024,
      cpu: 512,
      executionRole: executionRole,
      taskRole: serviceTaskRole,
    })

    const ec2TaskDef = new ecs.Ec2TaskDefinition(this, "FirelensSignalSampleEc2TaskDefinition", {
      executionRole: executionRole,
      taskRole: serviceTaskRole,
      networkMode: NetworkMode.AWS_VPC
    })

    const logGroup = new logs.LogGroup(this, 'FirelensSignalSampleLogGroup', {
      logGroupName: '/ecs/firelens-signal-sample-log',
      removalPolicy: RemovalPolicy.DESTROY // 今回は消す設定にする
    })
    const containerDef = taskDef.addContainer('FirelensSignalSampleContainerDefinition',{
      image: ecs.ContainerImage.fromRegistry("springmt/signal_sample_server:v0.1.0"),
      cpu: 256,
      memoryLimitMiB: 256,
      stopTimeout: Duration.seconds(10),
      essential: true,
      logging: ecs.LogDrivers.firelens({
        options: {
          Name: 'cloudwatch',
          region: 'ap-northeast-1',
          log_group_name: logGroup.logGroupName,
          log_stream_prefix: "signal_sample_server",
        }
      }),
    })
    ec2TaskDef.addContainer('FirelensSignalSampleEc2ContainerDefinition',{
      image: ecs.ContainerImage.fromRegistry("springmt/signal_sample_server:v0.1.0"),
      cpu: 256,
      memoryLimitMiB: 256,
      stopTimeout: Duration.seconds(10),
      essential: true,
      logging: ecs.LogDrivers.firelens({
        options: {
          Name: 'cloudwatch',
          region: 'ap-northeast-1',
          log_group_name: logGroup.logGroupName,
          log_stream_prefix: "signal_sample_server",
        }
      }),
    })
    /*
    taskDef.addFirelensLogRouter('test', {
      firelensConfig: {
        type: FirelensLogRouterType.FLUENTBIT,
      },
      image: ecs.ContainerImage.fromRegistry("public.ecr.aws/aws-observability/aws-for-fluent-bit:latest"),
    })
    */

    containerDef.addPortMappings({
      containerPort: 8080
    })
    const service = new ApplicationLoadBalancedFargateService(this, 'FirelensSignalSampleFargateService', {
      serviceName: 'firelens-signal-sample-fargate-service',
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      maxHealthyPercent: 200,
      minHealthyPercent: 50,
    })
    const service2 = new ecs.Ec2Service(this, 'FirelensSignalSampleService', {
      serviceName: "FirelensSignalSampleEC2API",
      cluster,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }),
      taskDefinition: ec2TaskDef,
      desiredCount: 1,
      maxHealthyPercent: 200,
      minHealthyPercent: 50,
      enableExecuteCommand: true,
    })
  }
}
