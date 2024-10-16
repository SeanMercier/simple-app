import * as cdk from 'aws-cdk-lib';
import * as lambdanode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as custom from 'aws-cdk-lib/custom-resources';
import { generateBatch } from '../shared/util';
import { movies, movieCasts } from '../seed/movies';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class SimpleAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Basic Lambda function
    const simpleFn = new lambdanode.NodejsFunction(this, 'SimpleFn', {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/simple.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
    });

    const simpleFnURL = simpleFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowedOrigins: ['*'],
      },
    });

    new cdk.CfnOutput(this, 'Simple Function Url', { value: simpleFnURL.url });

    // Movies DynamoDB table
    const moviesTable = new dynamodb.Table(this, 'MoviesTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: 'Movies',
    });

    // Movie Cast DynamoDB table with secondary index
    const movieCastsTable = new dynamodb.Table(this, 'MovieCastTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'movieId', type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: 'actorName', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: 'MovieCast',
    });

    movieCastsTable.addLocalSecondaryIndex({
      indexName: 'roleIx',
      sortKey: { name: 'roleName', type: dynamodb.AttributeType.STRING },
    });

    // Lambda function to get movie by ID
    const getMovieByIdFn = new lambdanode.NodejsFunction(this, 'GetMovieByIdFn', {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/getMovieById.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: moviesTable.tableName,
        REGION: 'eu-west-1',
      },
    });

    const getMovieByIdURL = getMovieByIdFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
      },
    });

    moviesTable.grantReadData(getMovieByIdFn);

    new cdk.CfnOutput(this, 'Get Movie Function Url', { value: getMovieByIdURL.url });

    // Initialize DynamoDB with seed data
    new custom.AwsCustomResource(this, 'moviesddbInitData', {
      onCreate: {
        service: 'DynamoDB',
        action: 'batchWriteItem',
        parameters: {
          RequestItems: {
            [moviesTable.tableName]: generateBatch(movies),
            [movieCastsTable.tableName]: generateBatch(movieCasts),
          },
        },
        physicalResourceId: custom.PhysicalResourceId.of('moviesddbInitData'),
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [moviesTable.tableArn, movieCastsTable.tableArn],
      }),
    });

    // Lambda function to get movie cast members with optional movie details
    const getMovieCastMembersFn = new lambdanode.NodejsFunction(this, 'GetCastMemberFn', {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/getMovieCastMembers.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        CAST_TABLE_NAME: movieCastsTable.tableName,
        MOVIE_TABLE_NAME: moviesTable.tableName,  // Ensure this is set for movie metadata
        REGION: 'eu-west-1',
      },
    });

    // Grant permissions to access both Movies and MovieCast tables
    moviesTable.grantReadData(getMovieCastMembersFn);
    movieCastsTable.grantReadData(getMovieCastMembersFn);

    // Add policies for specific DynamoDB actions
    getMovieCastMembersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [moviesTable.tableArn, movieCastsTable.tableArn],
    }));

    const getMovieCastMembersURL = getMovieCastMembersFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
      },
    });

    new cdk.CfnOutput(this, 'Get Movie Cast Url', {
      value: getMovieCastMembersURL.url,
    });
  }
}
