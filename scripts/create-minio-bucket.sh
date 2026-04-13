#!/bin/bash
# Creates the chartkeeper-dev bucket in local MinIO after Docker is up.
set -e

echo "Waiting for MinIO to be ready..."
until curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; do
  sleep 1
done

echo "Creating bucket..."
docker run --rm --network host \
  -e MC_HOST_local="http://chartkeeper:chartkeeper@localhost:9000" \
  minio/mc mb --ignore-existing local/chartkeeper-dev

echo "Bucket ready: chartkeeper-dev"
