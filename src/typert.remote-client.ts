/**
 * Remote-client typert manifest for the vscodeTools face, in the
 * @deepseek-ai/dsh-typert-generator remote-client format (see
 * dsh-api-workspace-files/lib/typert.remote-client.js). Value-imported and
 * inlined by this package's own client bundle, then $mounted onto the
 * browser's Remote service. Descriptors are shared with the host manifest via
 * ./typert.shared.ts.
 */
import {
  PKG,
  vscodeOpenInvocation,
  vscodeStatusInvocation,
  vscodeStopInvocation,
} from './typert.shared.js'

export const TYPERT_REMOTE = {
  package: PKG,
  descriptors: [
    vscodeOpenInvocation,
    vscodeStatusInvocation,
    vscodeStopInvocation,
  ],
}
export default TYPERT_REMOTE
