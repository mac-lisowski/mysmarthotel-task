#!/bin/bash
set -e

echo "MongoDB initialization script started"

# Wait a bit to ensure MongoDB is initially available
sleep 2

# Check if replica set is already initialized
IS_REPLICA_SET=$(mongosh --host mongodb:27017 --quiet --eval "rs.status().ok || 0" || echo "0")

if [ "$IS_REPLICA_SET" != "1" ]; then
  echo "Initializing MongoDB replica set..."
  mongosh --host mongodb:27017 --eval '
    rs.initiate({
      _id: "rs0",
      members: [
        {_id: 0, host: "mongodb:27017"}
      ]
    })
  ' || echo "rs.initiate command failed or already initiated"
  
  # Wait robustly for replica set primary to be elected
  echo "Waiting for replica set primary to be elected..."
  COUNTER=0
  MAX_RETRIES=30 # Wait for up to 60 seconds (30 * 2 seconds)
  PRIMARY_READY=0
  while [ $COUNTER -lt $MAX_RETRIES ]; do
    # Check if there is a primary member
    IS_PRIMARY=$(mongosh --host mongodb:27017 --quiet --eval "rs.status().members.find(m => m.stateStr === 'PRIMARY') ? 1 : 0" || echo "0")
    if [ "$IS_PRIMARY" == "1" ]; then
      echo "Replica set primary is ready."
      PRIMARY_READY=1
      break
    fi
    echo "Replica set primary not ready yet (attempt $((COUNTER+1))/$MAX_RETRIES)... waiting 2 seconds."
    sleep 2
    COUNTER=$((COUNTER + 1))
  done

  if [ "$PRIMARY_READY" == "0" ]; then
    echo "Error: Replica set primary did not become ready after $MAX_RETRIES attempts."
    # Optionally, print rs.status() for debugging
    mongosh --host mongodb:27017 --eval "rs.status()" || echo "Failed to get rs.status()"
    exit 1
  fi
  
else
  echo "Replica set is already initialized"
fi

# Now that the replica set is confirmed ready, proceed with user creation
# (Add a small delay just in case)
sleep 2 

# Check if admin user exists
# Add error handling for mongosh commands
ADMIN_USER_EXISTS=$(mongosh --host mongodb:27017 --quiet --eval 'db.getSiblingDB("admin").getUser("smarthotel") ? 1 : 0' || echo "Error checking admin user")

# Handle potential error during check
if [[ "$ADMIN_USER_EXISTS" == "Error"* ]]; then
    echo "$ADMIN_USER_EXISTS"
    exit 1
fi

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
  ' || echo "Error creating admin user"
else
  echo "Admin user already exists"
fi

# Check if application user exists
APP_USER_EXISTS=$(mongosh --host mongodb:27017 --quiet --eval 'db.getSiblingDB("smarthoteldb").getUser("smarthotelapp") ? 1 : 0' || echo "Error checking app user")

# Handle potential error during check
if [[ "$APP_USER_EXISTS" == "Error"* ]]; then
    echo "$APP_USER_EXISTS"
    exit 1
fi

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
  ' || echo "Error creating app user"
else
  echo "Application user already exists"
fi

echo "MongoDB initialization completed successfully" 