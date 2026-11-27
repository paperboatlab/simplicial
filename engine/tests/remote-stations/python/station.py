# The remote test station's code (remote_test.cpp): a block and a model, checked by their results.
import paperboat_runtime as pb


class Scale:
    def __init__(self, gain=1.0):
        self.gain = gain

    def step(self, ctx, inputs):
        if ctx["t"] == 0:
            print("scale starts", flush=True)
        return {"y": self.gain * inputs.get("u", 0.0)}


class Mass:
    """x'' = (f - k x) / m: from x0 at rest, x(t) = x0 cos(sqrt(k/m) t)."""

    def __init__(self, m=1.0, k=1.0, x0=1.0):
        self.m, self.k, self.x0 = m, k, x0

    def initial(self):
        return [self.x0, 0.0]

    def derivatives(self, t, x, inputs):
        return [x[1], (inputs.get("f", 0.0) - self.k * x[0]) / self.m]

    def read(self, x):
        return {"x": x[0], "v": x[1]}

    def entities(self, id, z, x):
        return [{"id": id + "/body", "shape": "box", "pos": [x[0], 0, z], "size": [0.2, 0.2, 0.2]}]


pb.register("scale", Scale, definition={"label": "Scale", "inputs": ["u"], "outputs": ["y"], "params": {"gain": 1.0}})
pb.register("mass", Mass, definition={
    "base": "model",
    "label": "Mass",
    "props": {"m": 1.0, "k": 1.0, "x0": 1.0},
    "block": {"inputs": ["f"], "outputs": ["x", "v"]},
})
