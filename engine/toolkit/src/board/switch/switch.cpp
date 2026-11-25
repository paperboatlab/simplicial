// board/switch.

#include "common.hpp"
#include "board/instruments_shared.hpp"

namespace paperboat::toolkit::board {
namespace {

class Switch final : public Block {
 public:
  explicit Switch(std::string key, int mode, double initial)
      : key_(std::move(key)), mode_(mode), initial_(initial > 0.0), state_(initial > 0.0) {}

  Values step(const Context& ctx, const Values&) override {
    // The board control sends the node id; `key` is an extra binding (a keyboard key).
    const auto held = [&](const std::string& key) {
      return ctx.keys_down != nullptr && !key.empty() && ctx.keys_down->contains(key);
    };
    const bool down = held(std::string(ctx.node)) || held(key_);
    if (first_) {
      first_ = false;
      state_ = initial_;
      last_down_ = down;
    } else {
      if (mode_ == 1) {
        state_ = down;
      } else {
        if (down && !last_down_) {
          state_ = !state_;
        }
      }
      last_down_ = down;
    }
    double val = state_ ? 1.0 : 0.0;
    return {{"y", val}, {"value", val}};
  }

 private:
  std::string key_;
  int mode_;
  bool initial_;
  bool state_;
  bool first_ = true;
  bool last_down_ = false;
};

Template switch_template() {
  Template t;
  t.name = "board/switch";
  t.def = {
      .type = "switch",
      .label = "Switch",
      .kind = Kind::Monitor,
      .inputs = {},
      .outputs = {{"y", "signal"}},
      .params = {
          {.id = "mode", .type = "enum", .default_text = "toggle", .options = {"toggle", "momentary"}},
          {.id = "initial", .default_value = 1.0, .type = "boolean"},
          ParamDef{.id = "key", .default_value = 0.0, .type = "text", .default_text = ""},
      },
      .instrument = "switch",
      .description = "A board switch: toggle (click to flip) or momentary (press and hold).",
      .view = {.compact = true, .glyph = "switch", .value = "{mode}", .icon = nlohmann::json::parse(R"({"w":1,"h":1,"g":[{"t":"line","p":[[5,65],[25,65]]},{"t":"ellipse","x":25,"y":60,"w":10,"h":10},{"t":"line","p":[[35,60],[70,30]]},{"t":"ellipse","x":70,"y":60,"w":10,"h":10},{"t":"line","p":[[80,65],[95,65]]}]})")},  // an open knife switch
  };
  t.make = [](const Values& p, const Config& config) {
    const int mode = config.contains("mode") && config.at("mode") == "momentary" ? 1 : 0;
    double initial = get_or(p, "initial", 1.0);
    std::string key = config.contains("key") ? config.at("key") : "";
    return std::make_unique<Switch>(std::move(key), mode, initial);
  };
  return t;
}

}  // namespace

void add_switch(Registry& registry) {
  registry.add(switch_template());
}

}  // namespace paperboat::toolkit::board
