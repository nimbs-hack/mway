import { Pass } from 'cesium'

// Cesium 1.147 waits for shader linking inside the draw call. Changing the
// terrain's texture count or mesh format can then stop input for hundreds of
// milliseconds. The engine patch adds a nonblocking readiness check. Draw
// each terrain command once its program is ready and request another frame
// while it compiles. Picking stays synchronous so clicks remain accurate.
export function deferTerrainShaders(scene) {
  const { context } = scene
  const draw = context.draw
  context.draw = function (command, passState, program, uniformMap) {
    const shader = program ?? command.shaderProgram
    if (scene.frameState.passes.render && command.pass === Pass.GLOBE && !shader._isReady()) {
      scene.requestRender()
      return
    }
    return draw.call(this, command, passState, program, uniformMap)
  }
  return () => { context.draw = draw }
}
