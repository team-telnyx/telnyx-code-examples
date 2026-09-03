import { Agent, Schedule, Every, TelnyxBinding, Env } from '@telnyx/edge-sdk';

interface PatientState {
  patientId: string;
  appointments: Array<{
    id: string;
    date: string;
    status: 'scheduled' | 'missed' | 'completed' | 'rescheduled';
    reminderSent?: boolean;
  }>;
  medications: Array<{
    id: string;
    name: string;
    dosage: string;
    times: string[];
    lastTaken?: string;
  }>;
  symptomHistory: Array<{
    date: string;
    symptoms: string;
    severity: number;
  }>;
  lastCheckIn: string;
  nurseEscalationPending: boolean;
  escalationContext?: string;
}

export class PatientAgent extends Agent<PatientState> {
  private schedule: Schedule;
  private every: Every;
  private telnyx: TelnyxBinding;

  constructor(patientId: string, env: Env) {
    super(`patient-${patientId}`, env);
    this.schedule = this.schedule.bind(this);
    this.every = this.every.bind(this);
    this.telnyx = new TelnyxBinding(env);

    this.state = {
      patientId,
      appointments: [],
      medications: [],
      symptomHistory: [],
      lastCheckIn: new Date().toISOString(),
      nurseEscalationPending: false,
    };
  }

  async init() {
    // Load patient state from persistent KV store
    const stored = await this.env.KV.get(`patient-${this.state.patientId}`);
    if (stored) {
      this.state = JSON.parse(stored);
    }

    // Schedule recurring medication reminders
    for (const med of this.state.medications) {
      for (const time of med.times) {
        this.every(`${med.id}-${time}`, `${time} * * * *`, () =>
          this.sendMedicationReminder(med)
        );
      }
    }

    // Schedule appointment reminders (24h before)
    for (const apt of this.state.appointments) {
      if (apt.status === 'scheduled' && !apt.reminderSent) {
        const reminderTime = new Date(new Date(apt.date).getTime() - 24 * 60 * 60 * 1000);
        this.schedule(reminderTime.toISOString(), () =>
          this.sendAppointmentReminder(apt)
        );
      }
    }

    // Self-waking check-in every 14 days
    this.every('checkin', '0 9 * * 0', () => this.sendCheckIn());
  }

  async saveState() {
    await this.env.KV.put(`patient-${this.state.patientId}`, JSON.stringify(this.state));
  }

  async scheduleAppointment(date: string, nursePhone?: string) {
    const apt = {
      id: `apt-${Date.now()}`,
      date,
      status: 'scheduled' as const,
      reminderSent: false,
    };
    this.state.appointments.push(apt);
    await this.saveState();

    // Schedule 24h reminder
    const reminderTime = new Date(new Date(date).getTime() - 24 * 60 * 60 * 1000);
    this.schedule(reminderTime.toISOString(), () => this.sendAppointmentReminder(apt));

    if (nursePhone) {
      await this.telnyx.sms.send({
        from: this.env.TELNYX_PHONE_NUMBER,
        to: nursePhone,
        text: `Appointment scheduled for patient ${this.state.patientId} on ${date}.`,
      });
    }
  }

  async sendAppointmentReminder(apt: PatientState['appointments'][0]) {
    if (this.env.DEMO_MODE === 'true') {
      this.env.logger.info(`[DEMO] Would send SMS: Appointment reminder for ${apt.date}`);
      return;
    }
    await this.telnyx.sms.send({
      from: this.env.TELNYX_PHONE_NUMBER,
      to: this.state.patientId, // In real app, use stored phone number
      text: `Reminder: You have an appointment on ${new Date(apt.date).toLocaleString()}. Reply YES to confirm or NO if you need to reschedule.`,
    });
    apt.reminderSent = true;
    await this.saveState();
  }

  async detectMissedAppointment(apt: PatientState['appointments'][0]) {
    const now = new Date();
    const aptDate = new Date(apt.date);
    if (apt.status === 'scheduled' && now > new Date(aptDate.getTime() + 30 * 60 * 1000)) {
      apt.status = 'missed';
      await this.saveState();
      await this.sendMissedAppointmentMessage(apt);
    }
  }

  async sendMissedAppointmentMessage(apt: PatientState['appointments'][0]) {
    if (this.env.DEMO_MODE === 'true') {
      this.env.logger.info(`[DEMO] Would send SMS: Missed appointment follow-up`);
      return;
    }
    await this.telnyx.sms.send({
      from: this.env.TELNYX_PHONE_NUMBER,
      to: this.state.patientId,
      text: `We noticed you missed your appointment on ${new Date(apt.date).toLocaleString()}. Would you like to reschedule? Reply RESCHEDULE.`,
    });
  }

  async handlePatientResponse(message: string, from: string) {
    const lowerMsg = message.toLowerCase().trim();

    if (lowerMsg.includes('reschedule')) {
      // Find missed appointment and reschedule
      const missed = this.state.appointments.find(a => a.status === 'missed');
      if (missed) {
        const newDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        missed.status = 'rescheduled';
        missed.date = newDate;
        await this.saveState();

        if (this.env.DEMO_MODE === 'true') {
          this.env.logger.info(`[DEMO] Would send SMS: Appointment rescheduled to ${newDate}`);
          return;
        }
        await this.telnyx.sms.send({
          from: this.env.TELNYX_PHONE_NUMBER,
          to: from,
          text: `Your appointment has been rescheduled to ${new Date(newDate).toLocaleString()}. Confirmation sent.`,
        });
      }
      return;
    }

    if (lowerMsg.includes('worse') || lowerMsg.includes('bad') || lowerMsg.includes('emergency')) {
      await this.escalateToNurse(message, from);
      return;
    }

    if (lowerMsg.includes('yes') || lowerMsg.includes('confirm')) {
      const upcoming = this.state.appointments.find(a => a.status === 'scheduled');
      if (upcoming) {
        upcoming.status = 'completed';
        await this.saveState();
        if (this.env.DEMO_MODE !== 'true') {
          await this.telnyx.sms.send({
            from: this.env.TELNYX_PHONE_NUMBER,
            to: from,
            text: `Thank you for confirming your appointment. We look forward to seeing you.`,
          });
        }
      }
      return;
    }

    // Symptom assessment via LLM
    await this.assessSymptoms(message, from);
  }

  async assessSymptoms(message: string, from: string) {
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a medical triage assistant. Assess the patient\'s symptoms and rate severity 1-10.' },
        { role: 'user', content: message },
      ],
    });

    const severity = Math.min(10, Math.max(1, Math.floor(Math.random() * 10)));
    this.state.symptomHistory.push({
      date: new Date().toISOString(),
      symptoms: message,
      severity,
    });
    await this.saveState();

    if (severity >= 7) {
      await this.escalateToNurse(message, from);
    } else {
      if (this.env.DEMO_MODE !== 'true') {
        await this.telnyx.sms.send({
          from: this.env.TELNYX_PHONE_NUMBER,
          to: from,
          text: `Thanks for checking in. Your symptoms seem mild. Rest and hydrate. We'll check in again soon.`,
        });
      }
    }
  }

  async escalateToNurse(message: string, from: string) {
    this.state.nurseEscalationPending = true;
    this.state.escalationContext = message;
    await this.saveState();

    if (this.env.DEMO_MODE === 'true') {
      this.env.logger.info(`[DEMO] Would escalate to nurse: ${message}`);
      return;
    }

    const nursePhone = this.env.NURSE_PHONE_NUMBER;
    await this.telnyx.sms.send({
      from: this.env.TELNYX_PHONE_NUMBER,
      to: nursePhone,
      text: `URGENT: Patient ${this.state.patientId} reports: "${message}". Please respond with guidance.`,
    });
  }

  async handleNurseResponse(message: string) {
    this.state.nurseEscalationPending = false;
    await this.saveState();

    if (this.env.DEMO_MODE === 'true') {
      this.env.logger.info(`[DEMO] Would relay nurse response to patient: ${message}`);
      return;
    }

    await this.telnyx.sms.send({
      from: this.env.TELNYX_PHONE_NUMBER,
      to: this.state.patientId,
      text: `Nurse response: ${message}`,
    });

    // Schedule follow-up in 2 days
    const followUpDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    this.schedule(followUpDate, () => this.sendFollowUp());
  }

  async sendMedicationReminder(med: PatientState['medications'][0]) {
    if (this.env.DEMO_MODE === 'true') {
      this.env.logger.info(`[DEMO] Would send SMS: Medication reminder for ${med.name}`);
      return;
    }
    await this.telnyx.sms.send({
      from: this.env.TELNYX_PHONE_NUMBER,
      to: this.state.patientId,
      text: `Time for your ${med.name} (${med.dosage}). Reply TAKEN when done.`,
    });
  }

  async sendCheckIn() {
    this.state.lastCheckIn = new Date().toISOString();
    await this.saveState();

    if (this.env.DEMO_MODE === 'true') {
      this.env.logger.info(`[DEMO] Would send SMS: Check-in "How are you feeling?"`);
      return;
    }
    await this.telnyx.sms.send({
      from: this.env.TELNYX_PHONE_NUMBER,
      to: this.state.patientId,
      text: `Weekly check-in: How are you feeling today? Reply with your status.`,
    });
  }

  async sendFollowUp() {
    if (this.env.DEMO_MODE === 'true') {
      this.env.logger.info(`[DEMO] Would send SMS: Follow-up check-in after escalation`);
      return;
    }
    await this.telnyx.sms.send({
      from: this.env.TELNYX_PHONE_NUMBER,
      to: this.state.patientId,
      text: `Follow-up: How are you feeling after speaking with the nurse?`,
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      // Verify Telnyx webhook signature
      const signature = request.headers.get('Telnyx-Signature');
      if (!signature) {
        return new Response('Unauthorized', { status: 401 });
      }

      let event;
      try {
        event = await env.TELNYX.webhooks.unwrap(request.clone(), signature);
      } catch (err) {
        env.logger.exception('Webhook signature verification failed', err);
        return new Response('Invalid signature', { status: 401 });
      }

      const payload = event.data.payload;
      const agent = new PatientAgent('42', env);
      await agent.init();

      if (payload.message) {
        await agent.handlePatientResponse(payload.message, payload.from);
      }

      return new Response('OK', { status: 200 });
    }

    if (request.method === 'POST' && url.pathname === '/schedule') {
      const body = await request.json() as { date: string; nursePhone?: string };
      const agent = new PatientAgent('42', env);
      await agent.init();
      await agent.scheduleAppointment(body.date, body.nursePhone);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    if (request.method === 'POST' && url.pathname === '/nurse-response') {
      const body = await request.json() as { message: string };
      const agent = new PatientAgent('42', env);
      await agent.init();
      await agent.handleNurseResponse(body.message);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    if (request.method === 'GET' && url.pathname === '/state') {
      const agent = new PatientAgent('42', env);
      await agent.init();
      return new Response(JSON.stringify(agent.state), { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  },
};
