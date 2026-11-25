// board/choice: a pick-one control on the Board.
//
// The instrument sends a key named "<node>:<index>" while a choice is pressed. The block
// latches that index and outputs it as `y`, with the chosen option's text as `name`. It is a
// Monitor with outputs, so the run samples `y` and the instrument keeps showing the choice.

#include "common.hpp"
#include "board/instruments_shared.hpp"

#include <algorithm>
#include <string>
#include <vector>

namespace paperboat::toolkit::board {
namespace {

std::vector<std::string> split_options(const std::string& text) {
  std::vector<std::string> out;
  std::string current;
  for (const char c : text) {
    if (c == ',' || c == '\n' || c == ';') {
      if (!current.empty()) out.push_back(current);
      current.clear();
    } else if (c != '\r') {
      current += c;
    }
  }
  if (!current.empty()) out.push_back(current);
  for (auto& option : out) {
    const auto first = option.find_first_not_of(" \t");
    const auto last = option.find_last_not_of(" \t");
    option = first == std::string::npos ? std::string{} : option.substr(first, last - first + 1);
  }
  out.erase(std::remove(out.begin(), out.end(), std::string{}), out.end());
  return out;
}

class Choice final : public Block {
 public:
  Choice(std::vector<std::string> options, int initial) : options_(std::move(options)), index_(initial) {
    if (options_.empty()) options_.push_back("off");
    index_ = std::clamp(index_, 0, static_cast<int>(options_.size()) - 1);
  }

  Values step(const Context& ctx, const Values&) override {
    if (ctx.keys_down) {
      const std::string prefix = std::string(ctx.node) + ":";
      for (std::size_t i = 0; i < options_.size(); ++i) {
        if (ctx.keys_down->contains(prefix + std::to_string(i))) {
          index_ = static_cast<int>(i);
          break;
        }
      }
    }
    return {{"y", static_cast<double>(index_)}, {"name", options_[static_cast<std::size_t>(index_)]}};
  }

 private:
  std::vector<std::string> options_;
  int index_;
};

}  // namespace

void add_choice(Registry& registry) {
  Template t;
  t.name = "board/choice";
  t.def = {.type = "choice",
           .label = "Choice",
           .kind = Kind::Monitor,
           .inputs = {},
           .outputs = {{"y"}, {"name"}},
           .params = {{.id = "initial", .default_value = 0.0, .type = "number"},
                      {.id = "options", .default_value = 0.0, .type = "text", .default_text = "Negroni, Spritz"}},
           .instrument = "choice",
           .description = "Pick one option on the Board; outputs its index and name."};
  t.make = [](const Values& p, const Config& config) {
    auto it = config.find("options");
    return std::make_unique<Choice>(split_options(it == config.end() ? "Negroni, Spritz" : it->second),
                                    static_cast<int>(get_or(p, "initial", 0.0)));
  };
  t.def.view = {.compact = true, .icon = nlohmann::json::parse(R"({"w":1,"h":1,"g":[{"t":"ellipse","x":10,"y":20,"w":10,"h":10},{"t":"line","p":[[30,25],[90,25]],"weight":"thin"},{"t":"ellipse","x":10,"y":45,"w":10,"h":10,"fill":"ink"},{"t":"line","p":[[30,50],[90,50]]},{"t":"ellipse","x":10,"y":70,"w":10,"h":10},{"t":"line","p":[[30,75],[90,75]],"weight":"thin"}]})")};
  registry.add(std::move(t));
}

}  // namespace paperboat::toolkit::board
