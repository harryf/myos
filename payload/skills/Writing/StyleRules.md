<!-- stylecheck-disable: vocab, copula-avoidance, opener-additive, hedge, not-just, moving-forward, vague-attribution, filler -->

# The myos house style

Everything myos writes for a person follows these rules: plans, updates, page and ad
copy, decision records, READMEs, commit messages, and the prose in a chat reply.

Three rules carry most of the weight. The rest is detail.

1. **No em dashes.** Not spaced, not closed. A comma, colon, semicolon or pair of brackets is
   always available and always clearer.
2. **Short English words beat long Latin ones.** Use, not utilize. Buy, not purchase. Enough,
   not sufficient.
3. **Cut any sentence whose only job is to say the subject matters.** If deleting a sentence
   loses no fact, it was padding.

## No em dashes

The em dash is the single loudest AI tell, and it is nearly always doing a job some other mark
does better.

| The dash was doing this | Use |
|---|---|
| introducing a definition or a list | a colon |
| joining two complete sentences | a semicolon, or two sentences |
| setting off an aside | brackets |
| anything else | a comma |

`Tools/StyleCheck.ts --fix` does this mechanically and gets it right most of the time. Read the
diff on anything a person will read.

En dashes in real ranges stay (`2-8 passes`, `E1-E5`). So do `--flags` and box-drawing runs.

## Words to drop

These are errors, not preferences.

| Drop | Use |
|---|---|
| pivotal, crucial, vital | important, main, central |
| key (as an adjective: key takeaway, key insight) | name the thing, or cut the word |
| underscores, highlights (as verbs) | shows, reveals, notes |
| showcase, boast, feature (as a verb) | has, includes |
| foster, cultivate (figurative) | build, grow, develop |
| garner | get, earn, win |
| delve, deep dive, unpack | look at, examine, explore |
| tapestry, landscape, realm, ecosystem (figurative) | field, area, world, system |
| testament to | shows, proves |
| vibrant, profound, intricate, nuanced | say what is specifically true |
| meticulous, meticulously | careful, thorough |
| robust, seamless, cutting-edge, holistic | strong, smooth, latest, whole |
| comprehensive | full, thorough, complete |
| leverage (as a verb) | use |
| utilize | use |
| aligns with, resonates with | fits, matches |
| actionable, impactful | usable, effective |
| learnings | lessons, findings |
| best practices | what works |
| in order to | to |
| due to the fact that | because |
| at its core | (cut, state the thing) |
| serves as, stands as, marks a | is, was |
| moving forward, going forward, ever-evolving | (cut, or state the timing) |
| Additionally, Furthermore, Moreover | And, Also, or restructure |
| In summary, In conclusion | (just conclude) |
| it is worth noting that | (state the thing) |
| not just X, but Y | (state the point) |

Terms of art keep their names. The `Comprehensive` effort tier, Meadows `leverage points`, a
test `harness`, a runtime `substrate`, the `_` `underscore` prefix: all fine, all known to the
checker.

## Words to prefer

English has two words for most things, one from Old English and one from French or Latin. The
short one is nearly always better: it is faster to read, cheaper in tokens, and harder to hide
behind.

This is a preference, not a ban. Where the Latin word is the precise technical term, keep it.
"Verification gate" stays. "We need to verify that the tests pass" becomes "check".

| Prefer | Over |
|---|---|
| use | utilize, employ |
| buy | purchase |
| get | obtain, acquire |
| need | require |
| help | assist, facilitate |
| try | attempt, endeavour |
| show | demonstrate, exhibit, illustrate |
| end | terminate, conclude |
| start, begin | initiate, commence |
| build, make | construct, produce |
| keep | maintain, retain |
| give | provide |
| enough | sufficient |
| about | approximately, regarding, concerning |
| next, later | subsequent |
| before | prior to |
| after | following, subsequent to |
| more | additional |
| many | numerous, multiple |
| let, allow | permit |
| find | locate, identify |
| send | transmit |
| ask | inquire, request |
| rest | remainder |
| change | modification, alteration |
| part | component, element |
| meet, hit | encounter |
| have, own | possess |
| tell | inform, notify |
| see, watch | observe |
| live, sit | reside |
| hide | conceal |
| understand | comprehend |
| speed up | accelerate |
| find out | ascertain, determine |
| do, build | implement |
| check | verify, validate |
| so | therefore, consequently, thus |
| but | however, nevertheless |
| and, also | furthermore, additionally |
| best | optimal |
| most | the majority of |
| person | individual |
| first | initial, primary |
| last | final, ultimate |
| whole | entire |
| often | frequently |
| fast, quick | rapid |
| right away | immediately |
| pick, choose | select |
| drop, cut | eliminate, remove |
| happen | occur |
| answer | respond |
| lower, cut | reduce |
| raise, grow | increase |
| think about | consider |
| put together | assemble |

## Structure

- No rule-of-three padding. "A, B, and C" written only to look thorough. Use two items, or four,
  or a sentence.
- No vague attribution. "Experts say", "studies show", "observers note". Name the source or make
  the claim yourself.
- No significance inflation. Do not add a sentence explaining why a mundane fact matters to a
  broader trend.
- No inline-header bullet lists (`- **Term:** description`). Use prose or a table. Reference
  documentation is the one exception, where a definition list is real structure.
- Sentence case for subheadings. Title case only for the document title.
- Bold for genuinely load-bearing terms, not for every takeaway.
- No conclusion that restates the opening.
- No `-ing` tail clauses that editorialise: "contributing to the team's velocity".
- No false ranges: "from Linear tickets to company strategy" where the two share no scale.

## Voice

Neutral and specific, not neutral and vaguely positive. "First shipped to 14 markets" beats
"rolled out widely". Vary sentence length; a run of 20-word sentences reads like a machine.
Repeat the clearest noun rather than cycling synonyms for it. Where you have an opinion, say it
in the first person and own it.

Warmth is not filler. Crediting a person by name, thanking a team that unblocked you, admitting
uncertainty plainly: these carry facts and stay. When reporting a problem, be direct without
alarm: the problem, the plan, the ask.

For a plan, a review or an update, every claim of status is backed by something a reader can
open: a commit, a URL, a test run, a log line. Never invented status.

## Before you send

1. Does any sentence exist only to say the subject matters? Delete it.
2. Is every adjective earning its place?
3. Does the conclusion restate the opening? Cut it.
4. Are three items listed where one sentence would do? Collapse them.
5. Any em dashes? Run the checker.

## The long version

`~/.myos/MYOS/DOCUMENTATION/Writing/AIWritingPatterns.md` has the full catalogue: severity
tiers, context profiles, three-tier word tables, and the detection patterns behind these rules.
Read it for a full audit. This file wins on any conflict.
