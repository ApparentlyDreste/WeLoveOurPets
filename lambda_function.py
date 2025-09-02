import json
import boto3
import os
from botocore.exceptions import ClientError
from decimal import Decimal
from boto3.dynamodb.conditions import Key

# Inicializa clientes de DynamoDB y S3
region = os.environ["REGION"]
dynamodb = boto3.resource('dynamodb', region_name=region)
dynamodb_name = os.environ["TABLE_NAME"]
dynamodb_table = dynamodb.Table(dynamodb_name)
s3_client = boto3.client('s3')

# Define rutas de los endpoints
status_check_path = '/status'
owner_path = '/owner'
owners_path = '/owners'

def lambda_handler(event, context):
    print('Request event: ', event)
    response = None

    try:
        http_method = event.get('httpMethod')
        path = event.get('path')

        if http_method == 'GET' and path == status_check_path:
            response = build_response(200, 'Service is operational')
        elif http_method == 'GET' and path == owner_path:
            query_params = event.get('queryStringParameters', {})
            owner_id = query_params.get('ownerid')
            if not owner_id:
                response = build_response(400, 'Missing ownerid parameter')
            else:
                response = get_owner(owner_id)
        elif http_method == 'GET' and path == owners_path:
            response = get_owners()
        elif http_method == 'POST' and path == owner_path:
            if not event.get('body'):
                response = build_response(400, 'Missing request body')
            else:
                try:
                    body = json.loads(event['body'])
                    response = save_owner(body)
                except json.JSONDecodeError:
                    response = build_response(400, 'Invalid JSON in request body')
        elif http_method == 'PATCH' and path == owner_path:
            if not event.get('body'):
                response = build_response(400, 'Missing request body')
            else:
                try:
                    body = json.loads(event['body'])
                    # Debo modificar esto 20/08/2025 > corregido: Usa ownerId y pasa updateKey/updateValue
                    if not body.get('ownerId') or not body.get('updateKey') or not body.get('updateValue'):
                        response = build_response(400, 'Missing ownerId, updateKey, or updateValue')
                    else:
                        response = modify_owner(body['ownerId'], body['updateKey'], body['updateValue'])
                except json.JSONDecodeError:
                    response = build_response(400, 'Invalid JSON in request body')
        elif http_method == 'DELETE' and path == owner_path:
            if not event.get('body'):
                response = build_response(400, 'Missing request body')
            else:
                try:
                    body = json.loads(event['body'])
                    response = delete_owner(body['ownerId'])
                except json.JSONDecodeError:
                    response = build_response(400, 'Invalid JSON in request body')
        elif http_method == 'OPTIONS':
            response = build_response(200, '')
        else:
            response = build_response(404, '404 Not Found')

    except Exception as e:
        print('Error:', e)
        response = build_response(400, 'Error processing request')

    return response

def get_owner(owner_id):
    try:
        if not owner_id:
            return build_response(400, 'Missing ownerid parameter')
        response = dynamodb_table.get_item(Key={'ownerid': owner_id})
        return build_response(200, response.get('Item'))
    except ClientError as e:
        print('Error:', e)
        return build_response(400, e.response['Error']['Message'])

def get_owners():
    try:
        scan_params = {
            'TableName': dynamodb_table.name
        }
        return build_response(200, scan_dynamo_records(scan_params, []))
    except ClientError as e:
        print('Error:', e)
        return build_response(400, e.response['Error']['Message'])

def scan_dynamo_records(scan_params, item_array):
    response = dynamodb_table.scan(**scan_params)
    item_array.extend(response.get('Items', []))
    if 'LastEvaluatedKey' in response:
        scan_params['ExclusiveStartKey'] = response['LastEvaluatedKey']
        return scan_dynamo_records(scan_params, item_array)
    else:
        return {'owners': item_array}

def save_owner(request_body):
    print('Received request_body:', request_body)
    try:
        required_fields = ['ownerid', 'ownername', 'petname', 'age', 'fileName', 'fileType']
        for field in required_fields:
            if field not in request_body or not request_body[field]:
                print(f'Validation failed for field: {field}')
                return build_response(400, f'Missing or invalid field: {field}')

        bucket_name = os.environ.get('S3_BUCKET_NAME')
        print(f'Bucket name from env: {bucket_name}')
        if not bucket_name or not isinstance(bucket_name, str) or bucket_name.startswith('arn:'):
            print('Invalid bucket name configuration')
            return build_response(400, 'Invalid or missing S3_BUCKET_NAME environment variable')

        file_name = request_body['fileName']
        file_type = request_body['fileType']
        print(f'Generating presigned URL for bucket: {bucket_name}, file: {file_name}')
        upload_presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={'Bucket': bucket_name, 'Key': file_name, 'ContentType': file_type},
            ExpiresIn=3600
        )
        get_presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket_name, 'Key': file_name},
            ExpiresIn=3600
        )

        item = {
            'ownerid': request_body['ownerid'],
            'ownername': request_body['ownername'],
            'petname': request_body['petname'],
            'age': request_body['age']
        }
        dynamodb_table.put_item(Item=item)

        body = {
            'Operation': 'SAVE',
            'Message': 'SUCCESS',
            'Item': item,
            'uploadUrl': upload_presigned_url,
            'fileUrl': get_presigned_url
        }
        return build_response(200, body)
    except ClientError as e:
        print('ClientError:', e)
        return build_response(400, e.response['Error']['Message'])
    except Exception as e:
        print('Unexpected error:', e)
        return build_response(400, f'Unexpected error: {str(e)}')

def modify_owner(owner_id, update_key, update_value):
    try:
        response = dynamodb_table.update_item(
            Key={'ownerid': owner_id},
            UpdateExpression=f'SET {update_key} = :value',
            ExpressionAttributeValues={':value': update_value},
            ReturnValues='UPDATED_NEW'
        )
        body = {
            'Operation': 'UPDATE',
            'Message': 'SUCCESS',
            'UpdatedAttributes': response
        }
        return build_response(200, body)
    except ClientError as e:
        print('Error:', e)
        return build_response(400, e.response['Error']['Message'])

def delete_owner(owner_id):
    try:
        response = dynamodb_table.delete_item(
            Key={'ownerid': owner_id},
            ReturnValues='ALL_OLD'
        )
        body = {
            'Operation': 'DELETE',
            'Message': 'SUCCESS',
            'Item': response
        }
        return build_response(200, body)
    except ClientError as e:
        print('Error:', e)
        return build_response(400, e.response['Error']['Message'])

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            if obj % 1 == 0:
                return int(obj)
            else:
                return float(obj)
        return super(DecimalEncoder, self).default(obj)

def build_response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*', #modify in prod
            'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        },
        'body': json.dumps(body, cls=DecimalEncoder)
    }