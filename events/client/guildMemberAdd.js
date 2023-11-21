import { handleException, log, error } from "../../modules/utils.js";
import dotenv from "dotenv";
dotenv.config();

const name = "guildMemberAdd";
const once = false;
async function execute(member) {
  const role = member.guild.roles.cache.get(process.env.DEFAULT_ROLE_ID);
  if (role) {
    member.roles.add(role);
  }
}

export { name, once, execute };
