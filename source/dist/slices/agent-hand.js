import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The machine author's hand. The port is the door for the HUMAN vocabulary —
// its emits list is the intent surface every view shares — but an authored
// tool speaks words the registry has never heard (BeatToggled, and whatever
// tomorrow's tool invents), and a harness could author such a tool yet not
// press its buttons. This slice closes that gap the architecture's own way:
// it answers OperateRequested by keeping a runtime speaker mounted — the
// agent-glove — whose contract is DATA, regrown one type larger whenever a
// novel word arrives. The emission therefore always comes from a mounted
// slice that declares it: the firewall stays the only validator, and every
// growth of the operated vocabulary lands on the board as a SliceMounted
// fact whose cause is the press that forced it. Authority is transparency,
// exactly the foundry's own pattern.
//
// One prudence, visible here in source the way every slice's opinions are:
// the glove speaks only SKETCHED vocabulary. Registry types
// have owners, and the port already speaks the human's words for them — a
// refused type simply carries no emission in its cascade, the same signage
// as a replace-match miss. Presses are not journaled, exactly like the
// human's clicks on the tool's own view.
//
// The glove's body closes over this slice's locals, so the glove itself is
// not adoptable (editing its stub earns a verdict, never a crash) — but a
// foreign unmount of the glove (an adoption attempt retiring it) is healed
// by remounting the current vocabulary. This body is self-contained, so the
// hand itself IS adoptable.
export const agentHand = defineSlice({
    type: "agent-hand",
    description: "Answers OperateRequested by growing a runtime speaker, the agent-glove.",
    consumes: [
        "OperateRequested",
        "SchemasDeclared",
        "ContractSketched",
        "SliceUnmounted",
    ],
    emits: ["ContractSketched"],
    start(context) {
        // The law's types, learned from the firewall's declaration — never
        // imported. Anything here is refused: it has an owner already. Sketched
        // words are tracked so a press of a truly novel word sketches it first
        // (sketching is registry vocabulary, not a privilege — the foundry does
        // the same for saved documents), keeping the firewall green.
        let contracted = new Set();
        const sketched = new Set();
        context.subscribe("SchemasDeclared", (fact) => {
            contracted = new Set(fact.payload.types);
        });
        context.subscribe("ContractSketched", (fact) => {
            for (const type of fact.payload.types)
                sketched.add(type);
        });
        // The operated vocabulary so far, the presses awaiting the next glove,
        // and the live glove instance.
        const spoken = new Set();
        const backlog = [];
        let gloveId = null;
        const gloveDefinition = () => ({
            type: "agent-glove",
            description: "The hand's speaker: a runtime contract grown to the operated words.",
            consumes: ["OperateRequested"],
            emits: [...spoken],
            start(glove) {
                // A snapshot: words that arrive later belong to the next glove,
                // which replays them from the backlog at its own birth.
                const speakable = new Set(spoken);
                for (const press of backlog.splice(0)) {
                    glove.emit(press.type, press.payload);
                }
                glove.subscribe("OperateRequested", (fact) => {
                    const press = fact.payload;
                    if (!speakable.has(press.type))
                        return;
                    glove.emit(press.type, press.payload ?? {});
                });
            },
        });
        context.subscribe("OperateRequested", (fact) => {
            const type = fact.payload.type;
            if (typeof type !== "string" || type.length === 0 || type === "*")
                return;
            // Prudence: the registry's words have owners; the port speaks them.
            if (contracted.has(type))
                return;
            // A known word: the live glove hears the same fact and speaks it.
            if (spoken.has(type))
                return;
            // A novel word: sketch it if the open vocabulary lacks it (delivered
            // before the glove's emission, so the firewall never sees an unknown
            // type), then retire the glove and mount one sized to the grown
            // vocabulary; the press rides the backlog into its start.
            if (!sketched.has(type)) {
                sketched.add(type);
                context.emit("ContractSketched", { types: [type] });
            }
            spoken.add(type);
            backlog.push({ type, payload: fact.payload.payload ?? {} });
            if (gloveId !== null)
                context.unmountSlice(gloveId);
            gloveId = context.mountSlice(gloveDefinition());
        });
        // A foreign unmount (an adoption attempt, a curious slice) retired the
        // glove: heal by remounting the vocabulary. Our own regrowth never lands
        // here — by the time its SliceUnmounted delivers, gloveId already names
        // the successor.
        context.subscribe("SliceUnmounted", (fact) => {
            if (fact.payload.sliceId !== gloveId)
                return;
            gloveId = spoken.size > 0 ? context.mountSlice(gloveDefinition()) : null;
        });
        return () => {
            if (gloveId !== null)
                context.unmountSlice(gloveId);
        };
    },
});
