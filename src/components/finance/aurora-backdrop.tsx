/**
 * Soft colour fields behind the whole app — they give the glass surfaces
 * something to diffuse. Shared by the main page and the onboarding screen.
 */
export function AuroraBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute -left-24 -top-32 h-[26rem] w-[26rem] rounded-full bg-sage-400/25 blur-3xl dark:bg-sage-500/10" />
      <div className="absolute -right-28 top-40 h-[24rem] w-[24rem] rounded-full bg-clay-400/20 blur-3xl dark:bg-clay-500/10" />
      <div className="absolute left-1/3 top-[46%] h-[22rem] w-[22rem] rounded-full bg-ochre-300/20 blur-3xl dark:bg-ochre-500/[0.07]" />
      <div className="absolute bottom-[-6rem] right-1/4 h-[20rem] w-[20rem] rounded-full bg-sage-400/20 blur-3xl dark:bg-sage-500/10" />
    </div>
  );
}
