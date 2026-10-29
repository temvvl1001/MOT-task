import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export const sqs = new SQSClient({});