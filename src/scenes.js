// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). They do
// nothing unless "Allow commands" is ticked in the configuration, and pfSense
// answers with its own refusal when the user of the key lacks the privilege.
//
//   - enable / disable a firewall rule followed in the configuration (by its
//     description; every rule with that description together): the parental
//     control "no internet for the kids' tablet after 21:00";
//   - reboot the firewall.
//
// Never anything else: the integration does not change the pfSense
// configuration beyond the `disabled` flag of the rules the user listed.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async enable_firewall_rule(hub, { fields = {} }) {
    const { active } = await hub.setRule(fields.rule, true);
    return { active };
  },

  async disable_firewall_rule(hub, { fields = {} }) {
    const { active } = await hub.setRule(fields.rule, false);
    return { active };
  },

  async reboot_firewall(hub) {
    await hub.reboot();
    return undefined;
  },
};
