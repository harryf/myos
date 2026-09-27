---
name: cs
description: Search prior myos work (sessions, ISAs, conversation logs) to add context to a request, or browse previous sessions on a topic. Shortcut for the ContextSearch skill.
argument-hint: [topic]
---

# cs

Thin invoker for the **ContextSearch** skill.

```
Skill("ContextSearch", "$ARGUMENTS")
```

Alone (`/cs <topic>`): show the results and ask what to do next. Before a request: run the search quietly and use the top hits to anchor the answer.
