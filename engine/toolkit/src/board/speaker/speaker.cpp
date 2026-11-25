// board/speaker: plays a numeric audio buffer on the Board.
//
// The station sends one control step's PCM samples as a numeric vector; the instrument
// queues them through Web Audio. The engine only samples the vector, so this block is a
// Monitor with one `any` input and no outputs.

#include "common.hpp"
#include "board/instruments_shared.hpp"

namespace paperboat::toolkit::board {
namespace {

class Speaker final : public Block {
 public:
  Values step(const Context&, const Values&) override { return {}; }
};

}  // namespace

void add_speaker(Registry& registry) {
  Template t;
  t.name = "board/speaker";
  t.def = {.type = "speaker",
           .label = "Speaker",
           .kind = Kind::Monitor,
           .inputs = {{"in", "any"}},
           .outputs = {},
           .params = {{.id = "rate", .default_value = 44100.0, .unit = "Hz"},
                      {.id = "volume", .default_value = 0.8}},
           .instrument = "speaker",
           .whole_vector = true,
           .description = "Plays a control step's PCM vector through the browser's audio output."};
  t.make = [](const Values&, const Config&) { return std::make_unique<Speaker>(); };
  t.def.view = {.compact = true, .value = "{rate} Hz", .icon = nlohmann::json::parse(R"({"w":1,"h":1,"g":[{"t":"poly","p":[[15,40],[30,40],[50,20],[50,80],[30,60],[15,60]]},{"t":"arc","x":40,"y":35,"w":20,"h":30,"a0":-45,"a1":45},{"t":"arc","x":30,"y":20,"w":40,"h":60,"a0":-45,"a1":45}]})")};
  registry.add(std::move(t));
}

}  // namespace paperboat::toolkit::board
