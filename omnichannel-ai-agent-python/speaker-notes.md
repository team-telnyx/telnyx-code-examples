# Omnichannel AI Agent — Speaker Notes

**Target length: 4-5 minutes**

---

## 1. INTRO — What We Built (30 sec)

Hey everyone — in this video I'm going to show you how to build an omnichannel AI agent that can email, text, and call your customers, all from a single Python app.

The idea is simple: you give the agent a customer scenario — like a billing dispute — and it autonomously decides which channels to use and in what order. It sends a formal email, follows up with an SMS, and even places a phone call. All powered by Telnyx.

What's cool here is that everything runs through one API key. The AI brain uses Telnyx Inference, the emails go through Telnyx Email API, SMS through Telnyx Messaging, and calls through Telnyx Call Control. One platform, one key, full omnichannel.

---

## 2. USE CASES (30 sec)

So where would you actually use something like this?

**Billing dispute resolution.** A customer disputes a charge. The agent sends a formal email acknowledging the issue with a reference number, texts them a quick confirmation with a timeline, and if it's complex, calls them to explain the resolution. Each message references the previous ones — the SMS says "we just emailed you," the call says "as mentioned in our email and text." That cross-channel context is what makes it feel like a real agent, not three disconnected bots.

**Appointment reminders and follow-ups.** Think healthcare or field services. The agent emails detailed prep instructions a week before, texts a reminder the day before, and calls the morning of if they haven't confirmed. Same agent, same context, different channels based on urgency.

---

## 3. TELNYX PORTAL SETUP — What You Need (45 sec)

Before we look at code, let me walk through what you need from the Telnyx Portal.

First, **a Telnyx API key**. This is the only credential the app needs — it powers the AI inference AND all the communication APIs. You generate this from the API Keys section in the portal.

Second, **a phone number**. Buy a number in the Numbers section — this is your "from" number for both SMS and voice calls.

Third, **a Messaging Profile**. Go to Messaging, create a profile, and assign your number to it. Grab the Messaging Profile ID — the app uses this to send SMS.

Fourth, **a Call Control connection**. Under Voice, create a Call Control Application. This gives you a Connection ID for placing outbound calls. Make sure it has an outbound voice profile assigned.

Fifth, **email setup**. Under the Email section, you'll have a shared sending domain available — something like `inbox@yoursubdomain.msgtelnyx.com`. For production you'd verify your own domain, but the shared one works for demos.

That's it — five things from the portal: API key, phone number, messaging profile ID, connection ID, and your email sending address.

---

## 4. DEMO WALKTHROUGH (2 min)

Alright, let's see it in action. I'll start the app with `python app.py`.

*[Show terminal: `python app.py` — server starts on port 5000]*

Now I'll open the dashboard at localhost:5000.

*[Show browser: dashboard loads with pre-filled customer info and scenario]*

You can see the dashboard has two panels — Agent Activity on the left shows the AI's thinking and tool calls in real-time, and Channel Timeline on the right shows the actual emails, texts, and calls as cards.

The customer info is pre-filled from the .env file — name, email, phone, and the scenario: "Customer is disputing a charge of $147.50 on their September statement."

Let me click Run Agent.

*[Click "Run Agent" — status changes to "Running"]*

Watch the left panel — you can see the agent thinking about what to do first. It decides to start with an email... there it goes, it called the `send_email` tool. The Channel Timeline shows the email card with the subject line and body. That's a real email — it just landed in my inbox.

Now it's thinking again... and it sends an SMS. You can see the green SMS card appear. That text just arrived on my phone.

And now the agent decides to call. There's the voice call card... and my phone is ringing right now.

*[Show phone ringing, let it ring]*

Finally, the agent calls `resolve_issue` to mark the case closed, and gives a summary of everything it did across all three channels.

*[Status changes to "Complete"]*

The key thing to notice is the context bar at the bottom — it tracked all these interactions in SQLite. If this customer calls back tomorrow, the agent knows exactly what happened across every channel.

---

## 5. OUTRO (30 sec)

So that's the omnichannel AI agent — about 700 lines of Python, one Telnyx API key, and you've got an agent that can email, text, and call customers autonomously.

The code is open source — link in the description. You can clone it, drop in your Telnyx API key, and have it running in minutes. The demo mode even works without any credentials if you just want to see the flow.

A few ideas for extending this: add inbound webhook handlers so the agent can respond to customer replies, plug in a real CRM instead of SQLite, or swap in a different model through the Telnyx Inference API — it's OpenAI-compatible so you can try Llama, Mistral, or whatever works best for your use case.

Thanks for watching — check out the Telnyx docs for more, and I'll see you in the next one.
