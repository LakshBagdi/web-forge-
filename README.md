FlowForge

Visual API Workflow Automation Platform featuring a drag-and-drop orchestration engine with Directed Acyclic Graph (DAG) execution, conditional branching, and robust failure recovery.

Overview

FlowForge simplifies the orchestration of multi-step API workflows, data transformations, and conditional operations. Traditional automation scripts often fail silently and are difficult to debug or resume. FlowForge provides a visual builder to construct DAG-based workflows, backed by a persistent execution engine that handles step-level retries, timeouts, and state recovery.

Core Features

Visual Workflow Editor: Drag-and-drop interface built with React Flow to define API requests, conditions, data transformations, delays, and triggers.

DAG Execution Engine: Evaluates dependencies, passes data between steps, and handles conditional branching.

Granular API Configuration: Full control over HTTP methods, headers, authentication, request bodies, and dynamic input parameters.

Resilient Execution: Powered by Redis and BullMQ to support job queues, retries, timeouts, and controlled re-execution of failed nodes.

Real-time Telemetry: Live execution status, step-level logs, and error tracing streamed to the client via WebSockets.

Lifecycle Management: Save, edit, duplicate, version, and validate workflows prior to execution to prevent invalid graphs.

Architecture

Frontend: React, TypeScript, Tailwind CSS, React Flow

Backend: Node.js, Express, WebSockets (Socket.io)

Database & Persistence: PostgreSQL (Prisma ORM)

Message Broker / Queue: Redis + BullMQ

Security & Constraints

Network Isolation: Workflows are executed within a restricted network context to prevent Server-Side Request Forgery (SSRF) and block arbitrary access to internal infrastructure.

Credential Management: External API keys and OAuth tokens are encrypted at rest.

Validation: Strict DAG validation prevents circular dependencies and unbound execution loops.
