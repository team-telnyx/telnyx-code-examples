/**
 * AI Tutor chat panel — calls the Telnyx Edge backend at /api/explain.
 */

let edgeUrl = '';  // set at boot

/** Configure the backend URL. */
export function setEdgeUrl(url) { edgeUrl = url.replace(/\/+$/, ''); }

/**
 * Send a question to the AI tutor and display the response.
 * @param {string} question
 * @param {object} vmContext — from ui.buildVMContext()
 * @param {function} onChunk — called with each text chunk
 * @param {function} onDone  — called when the response finishes
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

    const data = await res.json();
    if (data.response) {
      onChunk(data.response);
    } else if (data.error) {
      onChunk(`Error: ${data.error}`);
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
