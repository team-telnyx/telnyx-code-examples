/**
 * AI Tutor chat panel — calls the Telnyx Edge backend at /api/explain.
 */

let edgeUrl = '';  // set at boot

/** Configure the backend URL. */
export function setEdgeUrl(url) { edgeUrl = url.replace(/\/+$/, ''); }

/**
 * Send a question to the AI tutor and stream the response into the chat.
 * @param {string} question
 * @param {object} vmContext — from ui.buildVMContext()
 * @param {function} onChunk — called with each streamed text chunk
 * @param {function} onDone  — called when the stream finishes
 */
export async function ask(question, vmContext, onChunk, onDone) {
  const body = { question, vm_state: vmContext };

  try {
    const res = await fetch(`${edgeUrl}/api/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      onChunk(`Error: ${res.status} — ${text}`);
      onDone();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) onChunk(content);
          } catch {
            // Non-JSON data line — output as-is
            onChunk(data);
          }
        }
      }
    }
  } catch (err) {
    onChunk(`\nNetwork error: ${err.message}`);
  }

  onDone();
}

/**
 * Add a message bubble to the chat container.
 * @param {'user'|'assistant'} role
 * @param {string} text
 * @returns {HTMLElement} the content element (for streaming updates)
 */
export function addMessage(role, text) {
  const chat = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = `message ${role}`;

  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'You' : 'AI Tutor';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;

  bubble.appendChild(label);
  bubble.appendChild(content);
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;

  return content;
}
