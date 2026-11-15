// Let input and rendering run between CPU batches. MessageChannel avoids
// the increasing delay imposed on nested timers and background tabs.
export function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}
