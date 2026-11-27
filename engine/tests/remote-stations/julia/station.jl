# The remote test station's code (remote_test.cpp): a block and a model, checked by their results.

struct Scale
    gain::Float64
end
Scale(; gain = 1.0) = Scale(gain)
step(b::Scale, ctx, inputs) = Dict("y" => b.gain * get(inputs, "u", 0.0))

# x'' = (f - k x) / m: from x0 at rest, x(t) = x0 cos(sqrt(k/m) t).
struct Mass
    m::Float64
    k::Float64
    x0::Float64
end
Mass(; m = 1.0, k = 1.0, x0 = 1.0) = Mass(m, k, x0)
initial(s::Mass) = [s.x0, 0.0]
derivatives(s::Mass, t, x, inputs) = [x[2], (get(inputs, "f", 0.0) - s.k * x[1]) / s.m]
read(s::Mass, x) = Dict("x" => x[1], "v" => x[2])
entities(s::Mass, id, z, x) = [Dict("id" => id * "/body", "shape" => "box", "pos" => [x[1], 0, z], "size" => [0.2, 0.2, 0.2])]

PaperboatRuntime.register("scale", Scale; definition = Dict(
    "label" => "Scale", "inputs" => ["u"], "outputs" => ["y"], "params" => [("gain", 1.0)]))
PaperboatRuntime.register("mass", Mass; definition = Dict(
    "base" => "model",
    "label" => "Mass",
    "props" => [("m", 1.0), ("k", 1.0), ("x0", 1.0)],
    "block" => Dict("inputs" => ["f"], "outputs" => ["x", "v"]),
))
