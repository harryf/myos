# UpdatePatterns Workflow

Update Fabric patterns from the upstream repository to keep patterns current with latest improvements and additions.

---

## Prerequisites

The fabric CLI is optional. With it, `fabric -U` pulls the upstream patterns; without it, use the manual git update at the end of this file.

To install fabric:
```bash
go install github.com/danielmiessler/fabric@latest
```

---

## Workflow Steps

### Step 1: Check Current Pattern Count

```bash
CURRENT_COUNT=$(ls -1 ~/.myos/skills/Fabric/Patterns/ 2>/dev/null | wc -l | tr -d ' ')
echo "Current patterns: $CURRENT_COUNT"
```

### Step 2: Update via Fabric CLI

The fabric CLI handles pulling the latest patterns from the upstream repository:

```bash
fabric -U
```

This updates patterns in `~/.config/fabric/patterns/`.

### Step 3: Sync to Skill Directory

Copy updated patterns to the Fabric skill's local storage:

```bash
rsync -av --delete ~/.config/fabric/patterns/ ~/.myos/skills/Fabric/Patterns/
```

### Step 4: Drop the life coaching patterns

myos does not carry the life coaching patterns (the `telos` and `t_` families). Remove them after every sync, and drop their entries from `suggest_pattern`:

```bash
find ~/.myos/skills/Fabric/Patterns -maxdepth 1 -type d \( -name "telos*" -o -name "t_*" \) -exec rm -rf {} +
rg -il telos ~/.myos/skills/Fabric/Patterns   # must print nothing; edit any hit by hand
```

### Step 5: Report Results

```bash
NEW_COUNT=$(ls -1 ~/.myos/skills/Fabric/Patterns/ 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "Pattern update complete!"
echo "Previous count: $CURRENT_COUNT"
echo "New count: $NEW_COUNT"
if [ "$NEW_COUNT" -gt "$CURRENT_COUNT" ]; then
  ADDED=$((NEW_COUNT - CURRENT_COUNT))
  echo "Added: $ADDED new patterns"
fi
```

### Step 6: Verify Key Patterns Exist

Confirm critical patterns are present:

```bash
for pattern in extract_wisdom summarize create_threat_model analyze_claims; do
  if [ -d ~/.myos/skills/Fabric/Patterns/$pattern ]; then
    echo "✓ $pattern"
  else
    echo "✗ $pattern MISSING"
  fi
done
```

---

## Alternative: Manual Git Update

If fabric CLI is not available, you can update from the fabric repository directly:

```bash
# Clone or update fabric repo
cd /tmp
if [ -d fabric ]; then
  cd fabric && git pull
else
  git clone https://github.com/danielmiessler/fabric.git
  cd fabric
fi

# Sync patterns
rsync -av --delete patterns/ ~/.myos/skills/Fabric/Patterns/

# Cleanup
cd /tmp && rm -rf fabric
```

---

## Verification

After update, verify with:

```bash
# Count patterns
ls -1 ~/.myos/skills/Fabric/Patterns/ | wc -l

# List recent additions (if patterns have dates)
ls -lt ~/.myos/skills/Fabric/Patterns/ | head -10
```

---

## Output

Report to user:
- Previous pattern count
- New pattern count
- Number of patterns added (if any)
- Confirmation that sync completed successfully
