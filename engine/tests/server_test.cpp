// The server's shared live variables (Julix's, julix#44): every Julix window on the computer connects to a
// running station, so each connection's list is kept apart and the page sees them merged; an empty list (a Julix
// Start page, a fresh session) or a closed connection takes away only that connection's. The server writes its record,
// so a Julix running on this computer joins in: the names are ones no session of its has.

#include <chrono>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include <catch2/catch_test_macros.hpp>
#include <ixwebsocket/IXNetSystem.h>
#include <ixwebsocket/IXWebSocket.h>
#include <nlohmann/json.hpp>

#include "paperboat/core/server.hpp"
#include "rig.hpp"

namespace core = paperboat::core;
using json = nlohmann::json;

namespace {

// A socket to the server that keeps the last variables.remote it heard.
struct Client {
  ix::WebSocket ws;
  std::mutex mutex;
  json remote;  // null until one arrives
  bool open = false;

  explicit Client(int port) {
    ws.setUrl("ws://127.0.0.1:" + std::to_string(port));
    ws.disableAutomaticReconnection();
    ws.setOnMessageCallback([this](const ix::WebSocketMessagePtr& m) {
      std::lock_guard lock(mutex);
      if (m->type == ix::WebSocketMessageType::Open) open = true;
      if (m->type != ix::WebSocketMessageType::Message) return;
      const json msg = json::parse(m->str, nullptr, false);
      if (msg.is_object() && msg.value("type", "") == "variables.remote") remote = msg;
    });
    ws.start();
    REQUIRE(wait([this] { return open; }));
  }
  ~Client() { ws.stop(); }

  bool wait(const std::function<bool()>& ready) {
    for (int i = 0; i < 300; ++i) {
      {
        std::lock_guard lock(mutex);
        if (ready()) return true;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return false;
  }
  void set(const json& variables) {
    ws.sendText(json{{"type", "variables.set"}, {"source", "julix"}, {"variables", variables}}.dump());
  }
  // The shared value of `name` once it is `want` (null: once it is gone).
  bool sees(const std::string& name, const json& want) {
    return wait([&] {
      if (!remote.is_object()) return false;
      json got = nullptr;
      for (const auto& v : remote["variables"]) if (v.value("name", "") == name) got = v["value"];
      return got == want;
    });
  }
};

}  // namespace

TEST_CASE("live variables from several clients are merged; an empty list or a close takes only that client's") {
  ix::initNetSystem();
  static const core::Station station{.engine = "test", .catalog = &rig::catalog()};
  const int port = 52000 + static_cast<int>(std::chrono::steady_clock::now().time_since_epoch().count() % 900);
  core::Server server(station, port);
  REQUIRE(server.start().empty());
  {
    Client page(port);
    auto julix = std::make_unique<Client>(port);
    julix->set(json::array({{{"name", "server_test_k"}, {"type", "number"}, {"value", 2.5}}}));
    CHECK(page.sees("server_test_k", 2.5));

    // a second Julix with nothing to share, connecting later, leaves k as it is
    Client empty(port);
    empty.set(json::array());
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    CHECK(page.sees("server_test_k", 2.5));

    // another with its own: both are shared, and a name in the later list wins
    Client other(port);
    other.set(json::array({{{"name", "server_test_m"}, {"type", "number"}, {"value", 1}}, {{"name", "server_test_k"}, {"type", "number"}, {"value", 9}}}));
    CHECK(page.sees("server_test_m", 1));
    CHECK(page.sees("server_test_k", 9));
    other.set(json::array());
    CHECK(page.sees("server_test_m", nullptr));
    CHECK(page.sees("server_test_k", 2.5));

    // a page opened now gets them on connect
    Client late(port);
    CHECK(late.sees("server_test_k", 2.5));

    // the Julix that sent k quits: k goes
    julix.reset();
    CHECK(page.sees("server_test_k", nullptr));
  }
}
