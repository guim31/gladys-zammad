// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). The fields
// are strings, so a scene variable fits too (`{{triggerEvent.data.title}}`).
//
//   - `create_ticket`: open a ticket in a group, with a text, an optional
//     priority and customer (the leak sensor of the server room opens a
//     "Water detected" ticket for the Hardware team; a button by the printer
//     reports it out of paper).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async create_ticket(hub, { fields = {} }) {
    return hub.createTicket(fields);
  },
};
