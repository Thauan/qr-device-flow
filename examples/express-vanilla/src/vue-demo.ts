// Vue 3 demo for <qr-device-login>. Bundled to public/vue-app.js.
//
// Uses render functions (h) so no template compiler is needed. Vue turns
// `onQrApproved` into a listener for the "qr-approved" event.
import { createApp, defineComponent, h, ref } from "vue";
import "@qr-device-flow/element";

const log: Array<{ type: string; detail: unknown }> = [];
(window as unknown as { qrEvents: typeof log }).qrEvents = log;

const Login = defineComponent({
  setup() {
    const state = ref("pending");
    return () =>
      h("div", { class: "login", "data-vue-state": state.value }, [
        h("qr-device-login", {
          endpoint: "/device",
          transport: "sse",
          onQrState: (e: CustomEvent) => {
            state.value = e.detail.status;
            log.push({ type: "qr-state", detail: e.detail });
          },
          onQrApproved: (e: CustomEvent) => log.push({ type: "qr-approved", detail: e.detail }),
          onQrError: (e: CustomEvent) => log.push({ type: "qr-error", detail: e.detail }),
        }),
      ]);
  },
});

createApp(Login).mount("#app");
