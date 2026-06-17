import boto3
from botocore.client import Config
from app.core.config import settings

class MinIOStorageService:
    def __init__(self):
        endpoint = settings.MINIO_ENDPOINT
        # Ensure correct scheme
        if not endpoint.startswith("http://") and not endpoint.startswith("https://"):
            scheme = "https://" if settings.MINIO_SECURE else "http://"
            self.endpoint_url = f"{scheme}{endpoint}"
        else:
            self.endpoint_url = endpoint

        self.s3_client = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=settings.MINIO_ACCESS_KEY,
            aws_secret_access_key=settings.MINIO_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="us-east-1" # MinIO default placeholder
        )

    def ensure_bucket_exists(self, bucket_name: str) -> None:
        """
        Verifies if bucket exists, otherwise creates it.
        """
        try:
            self.s3_client.head_bucket(Bucket=bucket_name)
        except Exception:
            try:
                self.s3_client.create_bucket(Bucket=bucket_name)
                print(f"[STORAGE] Created MinIO bucket: {bucket_name}")
            except Exception as e:
                print(f"[STORAGE] Error creating bucket {bucket_name}: {e}")

    def upload_fileobj(self, fileobj, bucket_name: str, key: str, content_type: str) -> str:
        """
        Uploads a file-like object to a specific bucket and key.
        Returns the object's path/URL or key identifier.
        """
        self.ensure_bucket_exists(bucket_name)
        self.s3_client.upload_fileobj(
            fileobj,
            bucket_name,
            key,
            ExtraArgs={"ContentType": content_type}
        )
        # We return a standardized URL or just the object key
        return f"/api/events/media/{bucket_name}/{key}"

    def get_fileobj(self, bucket_name: str, key: str):
        """
        Retrieves a file object from MinIO to stream.
        """
        try:
            response = self.s3_client.get_object(Bucket=bucket_name, Key=key)
            return response["Body"], response.get("ContentType", "application/octet-stream")
        except Exception as e:
            print(f"[STORAGE] Error getting object {key} from bucket {bucket_name}: {e}")
            raise e

    def delete_fileobj(self, bucket_name: str, key: str) -> None:
        """
        Deletes a file object from MinIO.
        """
        try:
            self.s3_client.delete_object(Bucket=bucket_name, Key=key)
            print(f"[STORAGE] Deleted object {key} from bucket {bucket_name}")
        except Exception as e:
            print(f"[STORAGE] Error deleting object {key} from bucket {bucket_name}: {e}")

storage_service = MinIOStorageService()
