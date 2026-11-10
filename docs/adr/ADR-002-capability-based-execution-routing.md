# ADR-002: Capability-Based Execution Routing

- **Status:** Proposed
- **Date:** 2026-11-09
- **Decision Owners:** Vetor Architecture
- **Scope:** Execution Layer, Agent Harness Integration
- **Related:** [ADR-001](ADR-001-runtime-independence.md)

---

## 1. Context

Vetor is designed to operate independently of specific agent runtimes, harnesses, orchestration
platforms, and model providers.

Its existing architecture already provides mechanisms for delegation and orchestration, including:

- `OrchestratorAdapter`: abstraction for asynchronous orchestrator integrations.
- `OrchestratorRegistry`: discovery and selection of available orchestrators.
- `delegation-runtime.ts`: runtime selection and delegation through supported execution
  environments.
- Coordinator: task decomposition, worker allocation, affinity grouping, and execution coordination.
- Model health mechanisms: availability and selection of models in supported integrations.

However, executor selection is still predominantly driven by predefined preferences, runtime
availability, and task metadata.

As the number of supported harnesses and model providers increases, selecting an executor based only
on availability or manually configured preferences becomes increasingly insufficient.

Different harnesses expose different capabilities, tools, execution models, and operational
constraints.

A harness optimized for browser interaction may not be the best choice for systems programming. An
environment with strong CLI capabilities may be preferable for Rust debugging, while another may be
more suitable for frontend development or research.

Vetor should be able to identify these differences and automatically select the most appropriate
execution environment for each task.

This capability must not introduce mandatory dependencies on specific vendors or compromise the
existing runtime-independent architecture.

## 2. Problem Statement

Vetor needs a generic mechanism to:

1. Describe the capabilities of available agent harnesses.
2. Identify the requirements of incoming tasks.
3. Match task requirements against available execution capabilities.
4. Select the most appropriate authorized executor.
5. Define fallback strategies when an executor becomes unavailable or fails.
6. Improve future selection decisions using execution history.

The solution must preserve existing delegation and orchestration contracts.

## 3. Decision

Introduce a **Capability-Based Execution Routing** layer responsible for evaluating task
requirements and selecting the most appropriate execution environment.

The architecture will introduce three primary concepts:

- **Capability Registry:** maintains descriptions of available harnesses and their capabilities.
- **Task Profiler:** derives structured execution requirements from task metadata and context.
- **Execution Planner:** evaluates compatible executors and produces an execution plan.

The new layer will operate before the existing delegation or orchestration dispatch mechanisms.

It will not execute tasks, manage workers, or replace existing orchestrators.

### 3.1 Architectural Principles

The implementation MUST follow these principles:

1. Runtime independence: no harness or orchestrator is mandatory.
2. Capability-oriented selection: decisions must be based on declared and verified capabilities, not
   hardcoded vendor preferences.
3. Separation of concerns: task classification, executor selection, and execution remain independent
   responsibilities.
4. Backward compatibility: existing explicit executor preferences and delegation workflows must
   continue working.
5. Explainability: every automatic selection must have an inspectable decision rationale.
6. Security: automatic routing must only select previously authorized execution environments.
7. Incremental adoption: the new routing mechanism must initially operate without requiring
   Coordinator modifications.
8. Extensibility: adding a new harness should not require changes to the core routing algorithm.

## 4. Proposed Architecture

### 4.1 Capability Registry

Introduce a registry responsible for maintaining the capabilities of supported harnesses.

Proposed location:

`scripts/lib/capabilities/`

Initial responsibilities:

- Register harness descriptors.
- Discover available harness integrations.
- Validate capability declarations.
- Track availability and verification status.
- Expose capability queries.
- Support version-specific capability information.

A harness descriptor should distinguish between:

- Declared capabilities: capabilities advertised by the integration.
- Verified capabilities: capabilities confirmed through environment inspection or tests.
- Operational capabilities: capabilities currently available in the execution environment.

The registry must not assume that every advertised capability is operationally available.

### 4.2 Harness Capability Descriptor

Initial conceptual contract:

```ts
interface HarnessDescriptor {
  id: string;
  version?: string;

  capabilities: {
    domains: string[];
    operations: string[];

    tools: {
      terminal: boolean;
      filesystem: boolean;
      browser: boolean;
      git: boolean;
      mcp: boolean;
    };

    execution: {
      parallel: boolean;
      background: boolean;
      resumable: boolean;
      isolatedWorktree: boolean;
    };
  };

  models?: ModelDescriptor[];

  constraints: {
    maxContext?: number;
    requiresApproval: boolean;
    networkAccess?: boolean;
  };
}
```

This interface is illustrative and must be refined during the implementation spike.

Model information must remain distinct from harness capabilities. A harness may support multiple
models, and model availability must not be confused with execution capabilities.

### 4.3 Task Profiler

The Task Profiler converts existing task information into structured execution requirements.

Proposed location:

`scripts/lib/execution/task-profiler.ts`

Potential information sources:

- Issue labels.
- Task descriptions.
- Specs and acceptance criteria.
- ContextPacket.
- Target files.
- Module-test-map.
- Existing Coordinator metadata.
- Explicit user constraints.

Initial conceptual contract:

```ts
interface TaskProfile {
  domains: string[];
  operations: string[];

  complexity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";

  requirements: {
    filesystem?: boolean;
    terminal?: boolean;
    browser?: boolean;
    git?: boolean;
    parallelism?: boolean;
    longContext?: boolean;
  };

  constraints: {
    budget?: number;
    maxDurationMs?: number;
    dataSensitivity?: "public" | "private" | "sensitive";
  };
}
```

The initial implementation should prioritize deterministic classification using existing metadata.

Semantic classification through an LLM may be introduced as an optional fallback when structured
information is insufficient.

The system should avoid additional model calls when existing task information already provides
sufficient classification confidence.

### 4.4 Execution Planner

The Execution Planner evaluates task requirements against registered and authorized harnesses.

Proposed location:

`scripts/lib/execution/planner.ts`

Its responsibilities:

1. Receive a TaskProfile.
2. Retrieve available harness descriptors.
3. Eliminate executors that do not satisfy mandatory requirements.
4. Apply authorization and security constraints.
5. Evaluate compatible executors.
6. Produce an execution plan with a primary executor and optional fallback candidates.

The planner must be deterministic for identical inputs and configuration.

### 4.5 Capability Matching and Scoring

Mandatory requirements must be evaluated before scoring.

An executor that does not satisfy a mandatory requirement must be rejected regardless of its score.

Compatible executors may then be evaluated using configurable weighted criteria:

- Capability compatibility.
- Historical task quality.
- Availability and reliability.
- Latency.
- Estimated execution cost.

Conceptual scoring function:

```text
Score =
  capabilityCompatibility * weight
  + historicalQuality * weight
  + reliability * weight
  + latencySuitability * weight
  + costSuitability * weight
```

Weights must be configurable according to task profiles.

The initial implementation should use deterministic scoring and explicit rules rather than machine
learning.

## 5. Execution Policies

Routing must support three operational modes.

| Mode       | Behavior                                             |
| ---------- | ---------------------------------------------------- |
| Manual     | The user explicitly selects the executor.            |
| Assisted   | Vetor recommends an executor and requests approval.  |
| Autonomous | Vetor selects among previously authorized executors. |

Autonomous execution must be opt-in.

Existing explicit user preferences must take precedence over automatic routing unless the user
explicitly enables a different policy.

### 5.1 Fallback

The planner may provide an ordered list of alternative executors.

Fallback may be triggered by:

- Executor unavailability.
- Provider rate limits.
- Execution startup failures.
- Recoverable execution errors.
- Explicit timeout policies.

Fallback must not bypass authorization, data sensitivity, or mandatory capability requirements.

The initial implementation should support a configurable retry limit and prevent infinite retry
loops.

## 6. Execution Integration

The Execution Planner must integrate with existing execution mechanisms rather than introduce a new
execution runtime.

Two existing execution paths remain available:

**CLI Delegation**

Used for direct execution through supported harness integrations.

**Orchestrator Delegation**

Used for asynchronous execution through existing `OrchestratorAdapter` implementations.

The planner produces an execution plan that the existing delegation infrastructure consumes.

The Coordinator remains responsible for task decomposition, scheduling, worker allocation, and
orchestration.

This ADR does not authorize replacing or duplicating Coordinator responsibilities.

## 7. Proposed Module Structure

```text
scripts/lib/
├── capabilities/
│   ├── types.ts
│   ├── registry.ts
│   ├── discovery.ts
│   ├── profiles/
│   └── tests/
│
├── execution/
│   ├── task-profiler.ts
│   ├── requirements.ts
│   ├── matcher.ts
│   ├── scorer.ts
│   ├── planner.ts
│   ├── policy.ts
│   ├── fallback.ts
│   └── tests/
│
├── delegation-runtime.ts
│
└── orchestrator/
    ├── types.ts
    ├── registry.ts
    └── adapters/
```

This is a proposed organization, not a commitment to create every module immediately.

## 8. Security and Authorization

Capability matching must never be treated as authorization.

The following restrictions apply:

- Only authorized harnesses may be selected.
- Network access must respect execution policies.
- Sensitive task context must not be forwarded to unauthorized providers.
- Harness permissions must remain explicit.
- Automatic fallback must preserve the original security constraints.
- Execution approval requirements must not be silently bypassed.
- Capability declarations must not be trusted as proof of actual operational behavior.

The routing layer must preserve the existing security model of each execution adapter.

## 9. Observability and Feedback

Execution decisions should generate structured telemetry.

Potential metrics:

- Selected harness.
- Selected model, when applicable.
- Task domain and operation.
- Capability matching results.
- Selection rationale.
- Execution duration.
- Estimated cost.
- Completion status.
- Retry count.
- Fallback activation.
- Human intervention.
- Validation and test results.

Execution history may eventually improve routing decisions.

Historical performance must be evaluated by task domain and operation rather than treating a harness
as universally better than another.

The initial implementation should store deterministic metrics and avoid introducing a
machine-learning dependency.

## 10. Implementation Plan

### Phase 0: Architectural Investigation

Conduct a focused technical investigation before implementation.

Objectives:

1. Identify discovery mechanisms for Claude Code, Antigravity, OpenCode, Kilo, and Codex.
2. Determine which capabilities can be reliably detected.
3. Investigate differences between CLI execution and native agent execution.
4. Identify existing task metadata that can support deterministic classification.
5. Evaluate how model selection interacts with harness selection.
6. Define the minimum viable capability descriptor.

Deliverables:

- Harness capability matrix.
- Discovery feasibility report.
- Refined interface contracts.
- Architectural spike results.

### Phase 1: Capability Registry

Implement the initial descriptor contract, registry, and basic discovery mechanisms.

Requirements:

- Unit tests.
- Validation of descriptors.
- Capability queries.
- Explicit distinction between declared and verified capabilities.

No changes to Coordinator behavior.

### Phase 2: Task Profiling and Execution Planning

Implement deterministic task classification, mandatory capability matching, scoring, and execution
plan generation.

Initially, the planner should operate in recommendation or dry-run mode.

### Phase 3: Execution Integration

Connect the planner to existing CLI delegation and orchestrator dispatch mechanisms.

Introduce assisted routing and controlled fallback.

Preserve existing execution behavior when capability routing is disabled.

### Phase 4: Autonomous Routing

Enable autonomous selection for explicitly authorized execution environments.

Introduce configurable policies, retry limits, and fallback behavior.

### Phase 5: Historical Optimization

Collect execution metrics and use historical results to improve executor ranking.

Introduce more advanced classification only when justified by measured limitations of deterministic
profiling.

## 11. Acceptance Criteria

The initial implementation will be considered successful when:

- [ ] Multiple harnesses can be described using a common capability contract.
- [ ] Capability declarations and verification states are distinguishable.
- [ ] Available harnesses can be discovered without requiring all integrations to be installed.
- [ ] Task requirements can be generated from existing metadata.
- [ ] Mandatory capability mismatches eliminate incompatible executors.
- [ ] Compatible executors can be ranked deterministically.
- [ ] The planner provides an inspectable selection rationale.
- [ ] Manual, assisted, and autonomous policies are represented.
- [ ] Fallback respects authorization and task constraints.
- [ ] Existing delegation paths continue to work without mandatory migration.
- [ ] No Coordinator rewrite is required.
- [ ] Unit and integration tests cover routing and fallback behavior.

## 12. Alternatives Considered

### A. Hardcoded Domain-to-Harness Mapping

Example: frontend tasks always use Antigravity, Rust tasks always use Claude Code.

Rejected because it creates vendor coupling, does not account for runtime availability, and cannot
adapt to different model configurations.

### B. Routing Based Exclusively on Model Selection

Rejected because model quality does not determine harness execution capabilities.

A model may be excellent at a task but unavailable in a harness with the required tools or execution
behavior.

### C. Integrating Routing Directly into Coordinator

Rejected for the initial implementation because it mixes scheduling responsibilities with executor
selection and makes the capability mechanism less reusable.

### D. Introducing a New Universal Agent Runtime

Rejected because it duplicates existing delegation and orchestration infrastructure and conflicts
with the runtime-independent design objective.

## 13. Open Questions

The following decisions remain subject to investigation:

1. Should harness discovery use native CLI inspection, integration adapters, or both?
2. Which capability declarations can be automatically verified?
3. Should capability profiles be bundled with Vetor, provided by integrations, or both?
4. How should native harness subagents be represented?
5. Should model routing be exposed as a separate planner or remain entirely within harness
   integrations?
6. How should execution history be persisted?
7. What is the appropriate minimum confidence threshold for autonomous task classification?
8. How should concurrent execution and resource limits influence executor ranking?
9. Which existing Coordinator metadata can be reused without introducing coupling?

## 14. Consequences

### Positive

- Reduced dependency on individual AI providers.
- Better utilization of free and paid model capacity.
- More efficient allocation of specialized harnesses.
- Lower manual intervention in routine delegation.
- Improved extensibility and runtime independence.
- A foundation for historical optimization and adaptive execution.

### Trade-offs

- Additional architectural complexity.
- Capability descriptors require maintenance.
- Discovery may be limited by harness-specific interfaces.
- Historical quality measurements require sufficient execution data.
- Autonomous routing requires careful security and authorization controls.

## 15. Final Decision Summary

Vetor will introduce a capability-based execution planning layer between task interpretation and
existing execution dispatch.

This layer will independently describe harness capabilities, profile task requirements, evaluate
compatible executors, and generate explainable execution plans.

The implementation will begin with an architectural investigation and a minimal Capability Registry,
without modifying the Coordinator or replacing existing delegation mechanisms.

The long-term objective is to allow Vetor to automatically identify the most appropriate authorized
execution environment for each task, independently of specific harnesses, models, providers, or
orchestration platforms.
