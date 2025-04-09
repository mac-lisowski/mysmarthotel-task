#!/bin/bash
set -e

echo "MongoDB initialization script started"

# Wait a bit to ensure MongoDB is fully available
sleep 2

# Check if replica set is already initialized
IS_REPLICA_SET=$(mongosh --host mongodb:27017 --quiet --eval "rs.status().ok || 0")

if [ "$IS_REPLICA_SET" != "1" ]; then
  echo "Initializing MongoDB replica set..."
  mongosh --host mongodb:27017 --eval '
    rs.initiate({
      _id: "rs0",
      members: [
        {_id: 0, host: "mongodb:27017"}
      ]
    })
  '
  
  # Wait for replica set to initialize
  echo "Waiting for replica set to initialize..."
  sleep 5
else
  echo "Replica set is already initialized"
fi

# Check if admin user exists
ADMIN_USER_EXISTS=$(mongosh --host mongodb:27017 --quiet --eval 'db.getSiblingDB("admin").getUser("smarthotel") ? 1 : 0')

if [ "$ADMIN_USER_EXISTS" != "1" ]; then
  echo "Creating admin user..."
  mongosh --host mongodb:27017 --eval '
    db = db.getSiblingDB("admin");
    db.createUser({
      user: "smarthotel",
      pwd: "smarthotel",
      roles: [
        { role: "userAdminAnyDatabase", db: "admin" },
        { role: "dbAdminAnyDatabase", db: "admin" },
        { role: "readWriteAnyDatabase", db: "admin" },
        { role: "clusterAdmin", db: "admin" }
      ]
    });
  '
else
  echo "Admin user already exists"
fi

# Check if application user exists
APP_USER_EXISTS=$(mongosh --host mongodb:27017 --quiet --eval 'db.getSiblingDB("smarthoteldb").getUser("smarthotelapp") ? 1 : 0')

if [ "$APP_USER_EXISTS" != "1" ]; then
  echo "Creating application user..."
  mongosh --host mongodb:27017 --eval '
    db = db.getSiblingDB("smarthoteldb");
    db.createUser({
      user: "smarthotelapp",
      pwd: "smarthotelapp",
      roles: [
        { role: "readWrite", db: "smarthoteldb" }
      ]
    });
  '
else
  echo "Application user already exists"
fi

echo "MongoDB initialization completed successfully" 