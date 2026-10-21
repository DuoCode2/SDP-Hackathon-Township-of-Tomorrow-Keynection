"""What the assistant may answer questions from: the estate's house rules, the national renovation guideline, how
concerns, cases and warranty repairs work here, and where things are in the app. Plain text of about 1,500 tokens that
goes straight into the assistant's instructions, with no search index. Every line says something the app already shows
or enforces (the permit guide on the notice's approvals step, the house rules, the concern ladder, the warranty clock,
the screens), so an answer never goes beyond what the app itself says. Anything else is for the estate office front desk.
"""
from __future__ import annotations

GUIDELINE = """National renovation guideline (KPKT circular Bil. 3/2026, in force since 1 April 2026, followed by every \
council):
- Painting needs no permit; colours follow the council's guideline.
- Changing pipes or sanitary fittings, or tiling more than 6.5 m², needs a renovation permit from the council (PBT).
- Removing or laying tiles over 6.5 m², or small changes to internal walls, needs a renovation permit.
- Built-in cabinets or counters are on the permit list.
- A kitchen, porch or side extension needs a renovation permit on a sketch plan.
- A change to the structure needs building plans and a Certificate of Completion and Compliance (CCC) from a \
professional.
- Apply online through the council's One Stop Centre, OSC 3.0 Plus. A renovation permit takes up to 14 days.
- In a strata building (an apartment), the JMB or MC approves first.
- Keep "no permit needed" only if the council said so.
- Structural work waits for its approval: Keynection sends the notice only once the owner says it is approved.
- Neighbours are given the contractor's contact for complaints, as CIDB's Hak Jiran guidance asks."""

LADDER = """How concerns, cases and warranty repairs work in Keynection:
- A concern about a renovation (noise, hours, dust, damage) is raised in the private chat with the renovating owner. \
The renovating owner replies, and only they can mark it sorted.
- Only the neighbour who raised it can pass it to the SDP estate team: after 24 hours, or at any time if the problem \
comes back after it was marked sorted. The estate team sees a concern only once it is passed on; it can remind the \
owner of the house rules, or close it.
- Before works start, neighbours photograph shared walls, floors and ceilings; each photo is sealed with its date. A \
change seen later becomes a case that compares the two photos.
- The household that reported a case decides it: a building defect (reported to SDP's warranty team), ask an SDP \
inspector, or nothing to do. Saying the renovation caused it is only a proposal until the renovating owner agrees; \
they may disagree or ask an SDP inspector. Residents cannot record an inspector's finding.
- If the change was already in a photo taken before the works started, the renovation cannot have caused it.
- Defect liability: 24 months from handover. SDP repairs within 30 days of the owner's written notice (Housing \
Development Act, Schedules G and H). The 30-day clock never pauses.
- Only the homeowner closes a warranty ticket, by accepting the repair; rejecting it reopens the ticket with the \
clock unchanged.
- Quiet times: each home may name up to two a day, three hours in all. Nobody sees whose they are or why. Noisy \
renovation hours are planned around them, and the renovating owner always keeps at least four hours a day.
- Fees, a council's own extra rules, and anything not written here: ask the estate office front desk."""


GUIDE = """Where things are in Keynection (for "how do I..." questions):
- Neighbours: the five homes around you. Wave (once a day each), message them, and set "Your quiet times" (up to two \
a day, private).
- Chats: messages with neighbours; what you type arrives in the reader's language. In the chat with a renovating home, \
"Raise a concern" tells them privately first. The Estate Office channel carries the estate's notices (read only).
- Works: renovations around you and their noisy hours. "Register renovation" fills in a notice step by step (one \
sentence can fill it in) and shows on the plan who is told; you send it yourself.
- Photos & repairs: photograph shared walls, floors and ceilings before works start (sealed with the date); a later \
photo of a change opens a case; warranty tickets and their 30-day repair clock are here too.
- Me: your name, language and one-line bio; who can reach you (contact requests, waves, quiet mode); blocked homes; \
easy mode (bigger text and buttons); your home log.
- The EN / BM / 中 buttons at the top change the screens' language; each household reads messages in its own."""


def for_assistant(house_rules: list[str]) -> str:
    """The four parts, with the house rules for this kind of home (an apartment adds the lift and corridors)."""
    rules = "The estate's house rules for this home:\n" + "\n".join(f"- {rule}" for rule in house_rules)
    return f"{rules}\n\n{GUIDELINE}\n\n{LADDER}\n\n{GUIDE}"
