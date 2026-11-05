# Android `react-native-screens` backport

`react-native-screens+4.23.0.patch` backports upstream commit
[584fc86](https://github.com/software-mansion/react-native-screens/commit/584fc86ceb0b00fbabfbc878dd8f8f5a8a7c94f5)
(PR [#4637](https://github.com/software-mansion/react-native-screens/pull/4637)).
It changes only these four upstream files:

- `android/src/main/cpp/NativeProxy.cpp`
- `android/src/main/cpp/NativeProxy.h`
- `cpp/RNSScreenRemovalListener.cpp`
- `cpp/RNSScreenRemovalListener.h`

The mobile workspace pins the MIT-licensed dependency to `4.23.0`. Root
postinstall checks that the patch, dependency pin, and installed version agree,
then applies patches with `patch-package --error-on-fail`. This makes a version
mismatch a hard failure rather than patch-package's warning. Yarn Classic's
`postinstall-postinstall` companion also reruns that hook after `yarn remove`.
The upstream source and its contributor attribution remain under the package's
MIT license.

The backport addresses a known Fabric listener initialization/lifetime race
whose native dispatch signature matches the preserved Android tombstone. That
single report does not prove this race caused that crash. This is an
Android-native fix; compile it with `:app:assembleDebug` from
`apps/mobile/android`. It does not change iOS behavior.

Before upgrading `react-native-screens`, verify the candidate upstream release
contains the complete upstream fix. Then remove this patch, pin the selected
version, and remove `scripts/check-patches.mjs`, `patch-package`,
`postinstall-postinstall`, and the root postinstall script if no other patch
still needs them. Run the normal and frozen-lockfile installs and compile
Android before shipping; do not silently skip or retain a mismatched patch.
