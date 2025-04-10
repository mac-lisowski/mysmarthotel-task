# Task Processing Implementation Plan

## Phase 1: File Service Enhancement ✅
- [x] Add GetObjectCommand to FileService
- [x] Implement streaming download functionality
- [x] Add chunk processing for large files
- [x] Add retry mechanisms for S3 operations with exponential backoff
- [x] Implement proper error classification and handling
- [x] Add comprehensive logging

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
   - reservation_id not provided
   - guest_name empty/null
   - check_in_date missing
   - check_out_date missing
   - status missing

2. Invalid Data Formats:
   ```typescript
   {
     row: number,
     error: "Invalid date format for {fieldName}. Expected YYYY-MM-DD, got: {actualValue}"
   }
   ```
   - check_in_date not in YYYY-MM-DD format
   - check_out_date not in YYYY-MM-DD format
   - Invalid date range (check_out before check_in)

3. Invalid Status Values:
   ```typescript
   {
     row: number,
     error: "Invalid status value: {status}. Expected: PENDING, CANCELED, or COMPLETED"
   }
   ```

4. Duplicate Entries:
   ```typescript
   {
     row: number,
     error: "Duplicate reservation_id: {id} previously found in row {previousRow}"
   }
   ```

## 2. Processing Flow with Error Handling

### 2.1 Task Status Management
1. Initial Verification and Claiming:
   ```typescript
   // Replace simple findOne with atomic findOneAndUpdate
   const task = await taskModel.findOneAndUpdate(
     { 
       taskId: msg.payload.taskId,
       status: TaskStatus.PENDING,
       workerId: null
     },
     { 
       $set: {
         status: TaskStatus.IN_PROGRESS,
         startedAt: new Date(),
         workerId: this.workerId,
         processingAt: new Date()
       }
     },
     { new: true }
   );

   if (!task) {
     this.logger.warn(`Task ${msg.payload.taskId} could not be claimed or doesn't exist`);
     return;
   }
   ```

2. Status Updates (In Transaction):
   ```typescript
   // When completing task, ensure we still own it
   const updateResult = await taskModel.updateOne(
     { 
       taskId: msg.payload.taskId,
       workerId: this.workerId  // Ensure we still own the task
     },
     { 
       $set: {
         status: TaskStatus.COMPLETED,
         completedAt: new Date(),
         workerId: null,
         processingAt: null
       }
     },
     { session }
   );

   if (updateResult.modifiedCount === 0) {
     throw new Error('Task ownership lost during processing');
   }
   ```

### 2.2 File Processing Steps
1. S3 Download with Error Handling:
   ```typescript
   try {
     const fileStream = await fileService.downloadFile(msg.payload.filePath);
   } catch (error) {
     if (isS3RetryableError(error)) {
       return new Nack(false); // To DLQ
     }
     // Log non-retryable error and acknowledge
   }
   ```

2. XLSX Processing:
   - Read file in chunks
   - Track row numbers for error reporting
   - Maintain in-memory map of reservation_ids for duplicate detection

3. Per-Row Validation:
   ```typescript
   interface ValidationError {
     row: number;
     error: string;
     originalData?: any; // For debugging
   }
   
   const errors: ValidationError[] = [];
   ```

### 2.3 Business Rules Implementation
1. Reservation Status Rules:
   ```typescript
   if (reservation.status === 'CANCELED' || reservation.status === 'COMPLETED') {
     const existing = await reservationModel.findOne({ 
       reservationId: reservation.reservationId 
     });
     if (!existing) {
       errors.push({
         row: currentRow,
         error: `Skipped: ${reservation.status} reservation not found in database`
       });
       return;
     }
     // Update existing
   }
   ```

2. Date Validation Rules:
   ```typescript
   if (checkOutDate <= checkInDate) {
     errors.push({
       row: currentRow,
       error: `Invalid date range: check_out_date (${checkOutDate}) must be after check_in_date (${checkInDate})`
     });
   }
   ```

### 2.4 Error Recording in Database
1. Task Error Updates:
   ```typescript
   await taskModel.updateOne(
     { taskId: msg.payload.taskId },
     { 
       $set: {
         status: errors.length > 0 ? TaskStatus.FAILED : TaskStatus.COMPLETED,
         completedAt: new Date(),
         errors: errors.map(e => ({
           row: e.row,
           error: e.error
         }))
       }
     }
   );
   ```

2. Event Status Updates:
   ```typescript
   await eventModel.updateOne(
     { _id: msg.eventId },
     {
       $set: {
         status: EventStatus.PROCESSED,
         processedAt: new Date(),
         error: errors.length > 0 ? {
           message: `Processing failed with ${errors.length} errors`,
           details: errors
         } : undefined
       }
     }
   );
   ```

## 3. Implementation Order

### Phase 2: Task Processing Implementation
1. [ ] Update handleTaskCreated method:
   - [ ] Add task status verification
   - [ ] Add transaction support
   - [ ] Add error handling
2. [ ] Implement XLSX processing:
   - [ ] Add streaming reader
   - [ ] Add validation logic
   - [ ] Add error collection
3. [ ] Add reservation processing logic:
   - [ ] Status-based processing
   - [ ] Duplicate handling
   - [ ] Data validation

### Phase 3: Error Handling & Recovery
1. [ ] Implement DLQ logic for retryable errors
2. [ ] Add error logging and classification
3. [ ] Implement task error recording
4. [ ] Add recovery mechanisms

## 4. Testing Scenarios

### 4.1 Error Scenarios
1. File-Level Tests:
   - [ ] Empty XLSX file
   - [ ] Invalid file format
   - [ ] Missing required columns
   - [ ] S3 access errors

2. Row-Level Tests:
   - [ ] Missing required fields
   - [ ] Invalid date formats
   - [ ] Invalid status values
   - [ ] Duplicate reservation_ids
   - [ ] Date range violations

3. Business Rule Tests:
   - [ ] CANCELED/COMPLETED reservation not in database
   - [ ] CANCELED/COMPLETED reservation update
   - [ ] New reservation creation
   - [ ] Existing reservation update

### 4.2 DLQ Tests
1. S3 Connection Issues:
   - [ ] Verify message goes to DLQ
   - [ ] Verify retry behavior
2. MongoDB Transaction Issues:
   - [ ] Verify transaction retry behavior
   - [ ] Verify DLQ routing on persistent failures

## 5. Dependencies Required
- xlsx package (already installed)
- @aws-sdk/client-s3 (already installed)
- mongoose (already installed)
- class-validator (already installed)

## 6. Additional Considerations from Distributed Systems Rules

### 6.1 Transaction Management
- [ ] Implement proper session management for all database operations
- [ ] Add transaction retry logic for transient failures
- [ ] Handle nested transactions properly when calling across module boundaries
- [ ] Add proper error classification for transaction failures

### 6.2 Data Consistency
- [ ] Implement optimistic concurrency control using version fields
- [ ] Add atomic operations for critical updates
- [ ] Implement proper rollback mechanisms
- [ ] Add compensation logic for failed operations

### 6.3 Monitoring & Logging
- [ ] Add detailed logging for transaction outcomes
- [ ] Implement monitoring for worker processes
- [ ] Add logging for task execution progress
- [ ] Add performance monitoring

### 6.4 Resource Management
- [ ] Implement proper database connection handling
- [ ] Add proper cleanup for file streams
- [ ] Implement proper S3 client management
- [ ] Add resource cleanup in error scenarios 