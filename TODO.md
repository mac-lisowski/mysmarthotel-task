# Task Processing Implementation Plan

## Phase 1: File Service Enhancement ✅
- [x] Add GetObjectCommand to FileService
- [x] Implement streaming download functionality
- [x] Add chunk processing for large files
- [x] Add retry mechanisms for S3 operations with exponential backoff
- [x] Implement proper error classification and handling
- [x] Add comprehensive logging

## Phase 2: Task Processing Implementation (In Progress)
1. [x] Update handleTaskCreated method:
   - [x] Add task status verification
   - [x] Add transaction support
   - [x] Add error handling
2. [x] Implement XLSX processing:
   - [x] Add streaming reader
   - [x] Add validation logic
   - [x] Add error collection
3. [x] Add reservation processing logic:
   - [x] Status-based processing (handled via upsert)
   - [x] Duplicate handling (handled via upsert)
   - [x] Data validation (basic validation implemented)
4. [ ] Implement Error Recording in Database:

## 1. Error Classification & Handling

### 1.0 Distributed System Considerations
- Worker Instance Coordination:
  ```typescript
  // Use findOneAndUpdate with optimistic locking to claim the task
  const task = await taskModel.findOneAndUpdate(
    { 
      taskId: msg.payload.taskId,
      status: TaskStatus.PENDING,
      workerId: null  // Ensure no other worker has claimed it
    },
    { 
      $set: {
        status: TaskStatus.IN_PROGRESS,
        startedAt: new Date(),
        workerId: this.workerId,  // Set our worker ID
        processingAt: new Date()
      }
    },
    { new: true }
  );
  
  if (!task) {
    // Task was either:
    // 1. Already claimed by another worker
    // 2. Not in PENDING state
    // 3. Doesn't exist
    this.logger.warn(`Task ${msg.payload.taskId} could not be claimed - already being processed or doesn't exist`);
    return; // Acknowledge to prevent retries
  }
  ```

- Task Recovery (Stale Processing):
  ```typescript
  // Add to EventsService's recoverStaleEvents cron job pattern
  const staleThreshold = new Date();
  staleThreshold.setSeconds(staleThreshold.getSeconds() - STALE_TASK_THRESHOLD_SECONDS);
  
  const staleTasks = await taskModel.updateMany(
    {
      status: TaskStatus.IN_PROGRESS,
      processingAt: { $lt: staleThreshold }
    },
    {
      $set: { 
        status: TaskStatus.PENDING,
        workerId: null,
        processingAt: null
      }
    }
  );
  ```

- Transaction Management (Following distributed.mdc pattern):
  ```typescript
  const session = await connection.startSession();
  try {
    session.startTransaction();
    
    // Main processing logic
    await processReservations(fileStream, session);
    
    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    // Handle error based on type
    if (error.errorLabels?.includes('TransientTransactionError')) {
      return new Nack(false); // Retry via DLQ
    }
    throw error;
  } finally {
    await session.endSession();
  }
  ```

- Race Condition Prevention:
  ```typescript
  // Use atomic operations for updates
  const result = await reservationModel.findOneAndUpdate(
    { 
      reservationId: id,
      version: currentVersion  // Optimistic locking
    },
    {
      $set: { field: newValue },
      $inc: { version: 1 }
    },
    { new: true, session }
  );
  
  if (!result) {
    throw new Error('Concurrent modification detected');
  }
  ```

- Idempotency Handling:
  ```typescript
  // Check if we've already processed this event
  const existingEvent = await eventModel.findOne({
    'event.payload.taskId': msg.payload.taskId,
    status: EventStatus.PROCESSED
  });
  
  if (existingEvent) {
    this.logger.debug(`Event already processed for task ${msg.payload.taskId}`);
    return; // Acknowledge to prevent reprocessing
  }
  ```

### 1.1 Retryable Errors
- S3 Service Errors:
  - Connection timeouts (status codes 5xx)
  - Temporary access denied (status 403)
  - Rate limiting responses
  - Network connectivity issues
- MongoDB Transient Errors:
  - Write conflicts
  - Temporary connection issues
  - Transaction timeouts

### 1.2 Non-Retryable Errors (Must be Logged in Task.errors)
#### File-Level Errors
- Invalid XLSX format
- Empty file
- Corrupted file structure
- Missing required sheets

#### Row-Level Errors (Each Must Include Row Number)
1. Missing Required Fields:
   ```typescript
   {
     row: number,
     error: "Missing required field: {fieldName}"
   }
   ```