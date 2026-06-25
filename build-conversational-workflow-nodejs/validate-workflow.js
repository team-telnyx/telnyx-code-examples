const fs = require("node:fs");

const workflow = JSON.parse(fs.readFileSync("workflow.json", "utf8"));
const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
const errors = [];

assert(nodes.has(workflow.entry_node), `entry node ${workflow.entry_node} does not exist`);

for (const node of workflow.nodes) {
  checkNext(node.id, node.next);

  for (const branch of node.branches || []) {
    checkNext(node.id, branch.next);
  }

  for (const transition of ["on_success", "on_failure"]) {
    if (node[transition]) {
      checkNext(node.id, node[transition].next);
    }
  }

  if (node.type === "tool_call") {
    assert(workflow.tools[node.tool], `${node.id} references missing tool ${node.tool}`);
  }
}

for (const field of workflow.required_minimum_fields) {
  assert(
    workflow.field_collection.includes(field) || ["loss_type", "priority_flag", "consent_to_continue"].includes(field),
    `required field ${field} is not collected or set by workflow`
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`workflow validation error: ${error}`);
  }
  process.exit(1);
}

console.log(`workflow ok: ${workflow.name}`);
console.log(`nodes: ${workflow.nodes.length}`);
console.log(`tools: ${Object.keys(workflow.tools).length}`);

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function checkNext(sourceId, nextId) {
  if (nextId) {
    assert(nodes.has(nextId), `${sourceId} points to missing node ${nextId}`);
  }
}
