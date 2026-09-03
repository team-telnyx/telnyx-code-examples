import { Agent, AgentSocketServer, StateStore } from '@telnyx/edge-sdk';
import { createServer } from 'http';

// ---------------------------------------------------------------------------
// DebateAgent — two instances with opposing stances
// ---------------------------------------------------------------------------
class DebateAgent extends Agent {
  stance: 'pro' | 'con';
  topic: string;

  constructor(env: any, topic: string, stance: 'pro' | 'con') {
    super(env);
    this.topic = topic;
    this.stance = stance;
  }

  async generateArgument(previousArgument: string | null = null): Promise<string> {
    const prompt = this.buildPrompt(previousArgument);

    // Inference via Telnyx AI binding — zero-credential
    const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a debate agent arguing the ${this.stance} side. Be concise and persuasive.`,
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 256,
      temperature: 0.7,
    });

    const argument = response.choices[0]?.message?.content?.trim() ?? '';
    return argument;
  }

  private buildPrompt(previousArgument: string | null): string {
    if (previousArgument) {
      return `Topic: "${this.topic}". Rebuttal to the opposing argument: "${previousArgument}". Present your ${this.stance} argument.`;
    }
    return `Topic: "${this.topic}". Present your opening ${this.stance} argument.`;
  }
}

// ---------------------------------------------------------------------------
// DebateState — turn-based state management
// ---------------------------------------------------------------------------
interface VoteRecord {
  voterId: string;
  choice: 'pro' | 'con';
  timestamp: number;
}

class DebateState {
  private store: StateStore;
  topic: string;
  currentTurn: 'pro' | 'con';
  arguments: { stance: 'pro' | 'con'; text: string }[];
  votes: VoteRecord[];

  constructor(store: StateStore, topic: string) {
    this.store = store;
    this.topic = topic;
    this.currentTurn = 'pro';
    this.arguments = [];
    this.votes = [];
  }

  async save(): Promise<void> {
    await this.store.set('debate_state', {
      topic: this.topic,
      currentTurn: this.currentTurn,
      arguments: this.arguments,
      votes: this.votes,
    });
  }

  async load(): Promise<void> {
    const data = await this.store.get('debate_state');
    if (data) {
      this.topic = data.topic;
      this.currentTurn = data.currentTurn;
      this.arguments = data.arguments;
      this.votes = data.votes;
    }
  }

  switchTurn(): void {
    this.currentTurn = this.currentTurn === 'pro' ? 'con' : 'pro';
  }

  addArgument(stance: 'pro' | 'con', text: string): void {
    this.arguments.push({ stance, text });
  }

  addVote(voterId: string, choice: 'pro' | 'con'): void {
    this.votes.push({ voterId, choice, timestamp: Date.now() });
  }

  tallyVotes(): { pro: number; con: number } {
    return this.votes.reduce(
      (acc, vote) => {
        acc[vote.choice]++;
        return acc;
      },
      { pro: 0, con: 0 }
    );
  }

  getWinner(): 'pro' | 'con' | null {
    const tally = this.tallyVotes();
    if (tally.pro > tally.con) return 'pro';
    if (tally.con > tally.pro) return 'con';
    return null;
  }
}

// ---------------------------------------------------------------------------
// DebateOrchestrator — coordinates agents, WebSocket, and SQL
// ---------------------------------------------------------------------------
class DebateOrchestrator {
  private env: any;
  private agentPro: DebateAgent;
  private agentCon: DebateAgent;
  private state: DebateState;
  private socketServer: AgentSocketServer;

  constructor(env: any, topic: string) {
    this.env = env;
    this.agentPro = new DebateAgent(env, topic, 'pro');
    this.agentCon = new DebateAgent(env, topic, 'con');
    this.state = new DebateState(new StateStore(env), topic);
    this.socketServer = new AgentSocketServer(env);
  }

  async start(): Promise<void> {
    await this.state.load();

    // Broadcast debate start
    this.socketServer.broadcast({
      type: 'debate_started',
      topic: this.state.topic,
      timestamp: Date.now(),
    });

    // Agent A (pro) opening argument
    const proArgument = await this.agentPro.generateArgument();
    this.state.addArgument('pro', proArgument);
    this.socketServer.broadcast({
      type: 'argument',
      stance: 'pro',
      text: proArgument,
      turn: this.state.arguments.length,
    });
    await this.state.save();

    // Agent B (con) rebuttal
    const conArgument = await this.agentCon.generateArgument(proArgument);
    this.state.addArgument('con', conArgument);
    this.socketServer.broadcast({
      type: 'argument',
      stance: 'con',
      text: conArgument,
      turn: this.state.arguments.length,
    });
    this.state.switchTurn();
    await this.state.save();

    // Announce voting open
    this.socketServer.broadcast({
      type: 'voting_open',
      message: 'Audience, vote for the winner!',
    });
  }

  async handleVote(voterId: string, choice: 'pro' | 'con'): Promise<void> {
    this.state.addVote(voterId, choice);
    await this.state.save();

    // SQL tally — persist vote to database
    await this.env.SQL.prepare(
      'INSERT INTO votes (voter_id, choice, topic, timestamp) VALUES (?, ?, ?, ?)'
    ).bind(voterId, choice, this.state.topic, Date.now()).run();

    const tally = this.state.tallyVotes();
    this.socketServer.broadcast({
      type: 'vote_update',
      tally,
    });
  }

  async finalize(): Promise<{ winner: 'pro' | 'con' | null; tally: { pro: number; con: number } }> {
    const winner = this.state.getWinner();
    const tally = this.state.tallyVotes();

    this.socketServer.broadcast({
      type: 'debate_ended',
      winner,
      tally,
    });

    return { winner, tally };
  }
}

// ---------------------------------------------------------------------------
// HTTP server with WebSocket upgrade handling
// ---------------------------------------------------------------------------
const app = {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade endpoint
    if (url.pathname === '/ws') {
      const socketServer = new AgentSocketServer(env);
      const webSocket = socketServer.upgrade(request, env);
      if (webSocket) {
        return webSocket;
      }
    }

    // Start a new debate
    if (url.pathname === '/debate' && request.method === 'POST') {
      try {
        const body = await request.json() as { topic: string };
        const topic = body.topic || 'Resolved: AI will benefit humanity';
        const orchestrator = new DebateOrchestrator(env, topic);
        await orchestrator.start();
        return new Response(JSON.stringify({ status: 'debate_started', topic }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('Failed to start debate:', err);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Submit a vote
    if (url.pathname === '/vote' && request.method === 'POST') {
      try {
        const body = await request.json() as { voterId: string; choice: 'pro' | 'con' };
        const orchestrator = new DebateOrchestrator(env, 'current');
        await orchestrator.handleVote(body.voterId, body.choice);
        return new Response(JSON.stringify({ status: 'vote_recorded' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('Failed to record vote:', err);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Finalize debate and get winner
    if (url.pathname === '/debate/finalize' && request.method === 'POST') {
      try {
        const orchestrator = new DebateOrchestrator(env, 'current');
        const result = await orchestrator.finalize();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('Failed to finalize debate:', err);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

export default app;
