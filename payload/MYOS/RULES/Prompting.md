---
version: 1.0.0
---

# Ideal-State Prompting (on-demand)

Provenance: adapted from LifeOS RULES/Philosophy.md (ideal state prompting and the keep classes).

> Load when writing or auditing a skill body, workflow, agent brief, or any instruction to a model.

## Ideal-State Prompting: Prompt Engineering Is Articulating Done, Not Dictating How

The same epistemology governs how the system prompts itself. A prompt: a skill body, a workflow, an agent brief, any instruction to a model: is a description of a goal. By Deutsch, the good version is hard-to-vary: it names WHAT done looks like (the ideal state, as testable outcomes), the constraints that bound the solution space, and the high-quality tools available. It does not name HOW. The moment a prompt starts choreographing the model's reasoning: "first analyze the inputs, then consider the edge cases, then form a hypothesis, then decide"; it has stopped articulating the goal and started scripting the executor.

That scripting is the BPE (Bitter-Pill Engineering) failure mode, and it fails twice. First, it caps the model: a rigid procedure forces a capable model down a path it might have beaten, and the procedure can only be as smart as whoever wrote it. Second, it rots: every capability gain in the underlying model makes more of the methodology redundant, so a HOW-heavy prompt written for last year's model actively degrades this year's. This is the Bitter Lesson applied to prompting: general methods that use the model's own capability win over hand-engineered methodology, and the gap widens over time. The operative test for any procedural line is the BPE core question: *would a smarter model make this rule unnecessary?* If yes, it is scaffolding, not architecture, and it belongs cut.

Ideal-state prompting is the positive form of that cut. It is not vaguer than procedural prompting; it is **more** precise, because the specificity moves to where it belongs: the outcome. "Produce a threat model that enumerates every trust boundary and names a concrete attack against each" is a tighter instruction than a five-step methodology for how to think about threat modeling, and it survives model upgrades because it constrains the deliverable, not the reasoning. The ISA is this principle already made concrete for tasks: the ISC set IS the prompt, and it says only what done means. Prompting the rest of the system the same way is the natural extension.

Four classes of HOW are legitimate and survive the cut, because a smarter model does NOT make them unnecessary, they encode facts the model cannot derive from capability alone:

- **Safety-gates**: confirmation requirements, destructive-operation guards, approval boundaries. These bind regardless of model intelligence because they are about authority and consequence, not competence.
- **Verified-gotchas**: documented non-obvious failures the model would otherwise hit (a false-negativing token endpoint, an SPA fallback that fools curl). Empirical facts about the world, not reasoning crutches.
- **Tool-contracts**: exact CLI syntax, API parameters, file paths, deterministic invocation recipes. The precise WHAT of a tool call; a smarter model still can't guess an undocumented flag.
- **Output-format-contracts**: the required shape the deliverable must match (a schema, a template, the response banner). The model is free on HOW, bound on the final form.

Everything else that reads as procedure is a candidate to cut. The discipline for authoring any prompt in this system: state the ideal state, state the constraints, supply the tools, keep the four keep-classes, and delete the choreography.

Three clarifications keep the taxonomy honest, because the keep-classes are exactly what a defender of bad methodology will hide behind:

- **`verified-gotcha` needs provenance.** It is the leakiest class; anyone can relabel a pet procedure a "gotcha." A real gotcha points to a dated incident, a failing test, or a reproduction. No provenance → it is not a gotcha, it is methodology, and it is cut. This one bar is what stops the taxonomy from collapsing back to permissive.
- **The cut governs imperative process, not declarative facts.** Ideal-state prompting deletes *instructions on how to reason*. It does not delete environment facts, domain invariants, API shapes, or worked examples, a few-shot example demonstrates the output contract and is declarative, not choreography. Stripping domain knowledge or examples as "methodology" is over-cutting; the failure mode is symmetric with over-prompting.
- **The Algorithm is not exempt.** The Algorithm's *gates, artifacts, and telemetry* are system machinery: how the system manages state, evidence, and verification across a task, and those survive the cut as keep-classes. But anything inside the Algorithm that scripts cognition (a mandated restatement ritual, a required premortem line, a self-assigned score) is ordinary choreography and gets cut like anywhere else. Apply exactly this test to the Algorithm itself and remove what fails it. The distinction: choreographing the model's cognition is the BPE sin; sequencing the system's evidence-and-telemetry loop is not, and claiming the second while doing the first is how bad methodology hides.
