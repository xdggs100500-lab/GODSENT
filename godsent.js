const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");
const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
} = require("@discordjs/voice");
const playdl = require("play-dl");
const fs = require("fs");
const path = require("path");

// ---------------- CONFIG ----------------
const TOKEN = "MTQ1ODY4NDA2OTU2MTc2MTgyMg.GFcyK1._y6g9XUotYrkQUucyDDuwSm11THLfnI_Zma5cg";
const CLIENT_ID = "1458684069561761822";
const GUILD_ID = "1458680182079623302";
const VC_ID = "YOUR_VOICE_CHANNEL_ID"; // <-- Put your VC ID here

// ---------------- CLIENT ----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ---------------- ROLE BACKUP ----------------
const backupFile = path.join(__dirname, "roleBackup.json");
let roleBackup = fs.existsSync(backupFile)
  ? JSON.parse(fs.readFileSync(backupFile, "utf8"))
  : {};
const saveBackup = () =>
  fs.writeFileSync(backupFile, JSON.stringify(roleBackup, null, 2));

// ---------------- MOD LOG WITH EMBED ----------------
async function logModAction(guild, description) {
  let ch = guild.channels.cache.find(
    c => c.name === "mod-logs" && c.type === ChannelType.GuildText
  );
  if (!ch) {
    ch = await guild.channels.create({
      name: "mod-logs",
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      ],
    });
  }

  const embed = new EmbedBuilder()
    .setDescription(description)
    .setColor("#ff0000")
    .setTimestamp();

  ch.send({ embeds: [embed] }).catch(() => {});
}

// ---------------- MUTED ROLE ----------------
async function getMutedRole(guild) {
  let role = guild.roles.cache.find(r => r.name === "Muted");
  if (!role) {
    role = await guild.roles.create({ name: "Muted" });
    guild.channels.cache.forEach(ch => {
      ch.permissionOverwrites
        .edit(role, { SendMessages: false, AddReactions: false, Speak: false })
        .catch(() => {});
    });
  }
  return role;
}

// ---------------- MUSIC ----------------
const players = new Map();
function getPlayer(guildId) {
  if (!players.has(guildId)) {
    players.set(
      guildId,
      createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } })
    );
  }
  return players.get(guildId);
}

// ---------------- PERSISTENT VC ----------------
const persistentVCConnections = {};
async function joinPersistentVC(guild, channel) {
  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    persistentVCConnections[guild.id] = connection;

    connection.on("stateChange", (oldState, newState) => {
      if (newState.status === "disconnected") {
        setTimeout(() => joinPersistentVC(guild, channel), 5000);
      }
    });
  } catch (err) {
    console.error("Persistent VC error:", err);
  }
}

// ---------------- SLASH COMMANDS ----------------
const commands = [
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute a user")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .addUserOption(o =>
      o.setName("user").setDescription("User to mute").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Unmute a user")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .addUserOption(o =>
      o.setName("user").setDescription("User to unmute").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("joinvc")
    .setDescription("Bot joins your voice channel (mod only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

  new SlashCommandBuilder()
    .setName("leavevc")
    .setDescription("Bot leaves the voice channel (mod only)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play music from YouTube only")
    .addStringOption(o =>
      o.setName("query").setDescription("YouTube link or song name").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop music and leave VC")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Get information about a user")
    .addUserOption(o =>
      o.setName("user").setDescription("User to view").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("serverprofile")
    .setDescription("View your profile in this server"),

  new SlashCommandBuilder()
    .setName("servericon")
    .setDescription("View the server icon"),
].map(c => c.toJSON());

// ---------------- REGISTER ----------------
const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("Slash commands registered");
})();

// ---------------- INTERACTIONS ----------------
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;
  const member = i.options.getMember("user") || i.member;

  // ---------- PERMISSION CHECK ----------
  const isMod = i.member.permissions.has(PermissionsBitField.Flags.ManageRoles);

  // ------------- MUTE -------------
  if (i.commandName === "mute") {
    if (!isMod)
      return i.reply({ content: "Only mods can use this command.", ephemeral: true });

    const role = await getMutedRole(i.guild);
    roleBackup[i.guild.id] ??= {};
    roleBackup[i.guild.id][member.id] =
      member.roles.cache.filter(r => r.id !== i.guild.id).map(r => r.id);
    saveBackup();

    await member.roles.set([role]);
    i.reply({ content: `Muted ${member.user.tag}`, ephemeral: false });
    logModAction(i.guild, `🔇 Muted **${member.user.tag}**`);
  }

  // ------------- UNMUTE -------------
  if (i.commandName === "unmute") {
    if (!isMod)
      return i.reply({ content: "Only mods can use this command.", ephemeral: true });

    const role = await getMutedRole(i.guild);
    await member.roles.remove(role);
    const roles = roleBackup[i.guild.id]?.[member.id];
    if (roles) await member.roles.add(roles);
    delete roleBackup[i.guild.id][member.id];
    saveBackup();
    i.reply({ content: `Unmuted ${member.user.tag}`, ephemeral: false });
    logModAction(i.guild, `✅ Unmuted **${member.user.tag}**`);
  }

  // ------------- JOIN VC (MOD ONLY) -------------
  if (i.commandName === "joinvc") {
    if (!isMod)
      return i.reply({ content: "Only mods can use this command.", ephemeral: true });

    const vc = i.member.voice.channel;
    if (!vc) return i.reply({ content: "Join a VC first.", ephemeral: true });
    joinPersistentVC(i.guild, vc);
    i.reply("✅ Joined VC (24/7, mod-only)");
  }

  // ------------- LEAVE VC -------------
  if (i.commandName === "leavevc") {
    if (!isMod)
      return i.reply({ content: "Only mods can use this command.", ephemeral: true });
    getVoiceConnection(i.guild.id)?.destroy();
    i.reply("✅ Left VC");
  }

  // ---------- PLAY MUSIC ----------
  if (i.commandName === "play") {
    const vc = i.member.voice.channel;
    if (!vc) return i.reply({ content: "Join a VC first.", ephemeral: true });
    await i.deferReply();

    try {
      const query = i.options.getString("query");
      let urlToPlay;

      if (playdl.yt_validate(query) === "video") {
        urlToPlay = query;
      } else {
        const search = await playdl.search(query, { limit: 1 });
        if (!search || search.length === 0)
          return i.editReply("No results found for your query.");
        urlToPlay = search[0].url;
      }

      const streamData = await playdl.stream(urlToPlay, { discordPlayerCompatibility: true });
      if (!streamData?.stream) return i.editReply("Failed to fetch the audio stream.");

      const resource = createAudioResource(streamData.stream, { inputType: streamData.type });
      let conn = getVoiceConnection(i.guild.id);
      if (!conn) conn = joinPersistentVC(i.guild, vc);
      const player = getPlayer(i.guild.id);
      conn.subscribe(player);
      player.play(resource);
      i.editReply(`▶️ Now playing: **${query}**`);
    } catch (err) {
      console.error(err);
      i.editReply("❌ Failed to play this track. Only valid YouTube links or search queries work.");
    }
  }

  // ---------- STOP MUSIC ----------
  if (i.commandName === "stop") {
    getVoiceConnection(i.guild.id)?.destroy();
    players.get(i.guild.id)?.stop();
    i.reply("⏹️ Stopped music");
  }

  // ---------- USER INFO ----------
  if (i.commandName === "userinfo") {
    const e = new EmbedBuilder()
      .setTitle(`User Info: ${member.user.tag}`)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: "ID", value: member.id, inline: true },
        {
          name: "Created",
          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
          inline: true,
        },
        {
          name: "Joined",
          value: `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:F>`,
          inline: true,
        }
      )
      .setColor("#00ff00");
    i.reply({ embeds: [e] });
  }

  // ---------- SERVER PROFILE ----------
  if (i.commandName === "serverprofile") {
    const e = new EmbedBuilder()
      .setTitle(`Server Profile: ${i.user.tag}`)
      .addFields({
        name: "Roles",
        value:
          i.member.roles.cache
            .filter(r => r.id !== i.guild.id)
            .map(r => r.name)
            .join(", ") || "No roles",
      })
      .setColor("#ffa500");
    i.reply({ embeds: [e] });
  }

  // ---------- SERVER ICON ----------
  if (i.commandName === "servericon") {
    const e = new EmbedBuilder()
      .setTitle(i.guild.name)
      .setImage(i.guild.iconURL({ size: 1024 }))
      .setColor("#00ffff");
    i.reply({ embeds: [e] });
  }
});

// ---------------- ANTI LINK ----------------
client.on("messageCreate", async m => {
  if (!m.guild || m.author.bot) return;
  if (m.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;

  if (/(https?:\/\/|discord\.gg|discord\.com\/invite)/i.test(m.content)) {
    await m.delete().catch(() => {});
    await m.member.timeout(5 * 60 * 1000, "Link detected").catch(() => {});
    logModAction(m.guild, `⛔ Timed out **${m.author.tag}** for sending a link`);
  }
});

// ---------------- DELETED MESSAGE LOG ----------------
client.on("messageDelete", m => {
  if (!m.guild || !m.author) return;
  const embed = new EmbedBuilder()
    .setTitle("🗑️ Message Deleted")
    .setColor("#ff0000")
    .addFields(
      { name: "Author", value: m.author.tag, inline: true },
      { name: "Channel", value: `${m.channel}`, inline: true },
      { name: "Content", value: m.content || "No text content" }
    )
    .setTimestamp();

  let ch = m.guild.channels.cache.find(c => c.name === "mod-logs" && c.type === ChannelType.GuildText);
  if (!ch) {
    m.guild.channels.create({
      name: "mod-logs",
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: m.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      ],
    }).then(channel => channel.send({ embeds: [embed] }));
  } else {
    ch.send({ embeds: [embed] });
  }
});

// ---------------- VOICE STATE LOGS ----------------
client.on("voiceStateUpdate", (oldState, newState) => {
  if (newState.member.user.bot) return;

  if (!oldState.channelId && newState.channelId) {
    logModAction(newState.guild, `🔊 **${newState.member.user.tag}** joined VC: **${newState.channel.name}**`);
  }
  if (oldState.channelId && !newState.channelId) {
    logModAction(newState.guild, `🔇 **${newState.member.user.tag}** left VC: **${oldState.channel.name}**`);
  }
});

// ---------------- BOOSTER ROLE ----------------
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    if (!oldMember.premiumSince && newMember.premiumSince) {
      let role = newMember.guild.roles.cache.find(r => r.name === "Exclusive");
      if (!role) {
        role = await newMember.guild.roles.create({
          name: "Exclusive",
          color: "#FFD700",
          reason: "Booster role",
        });
      }
      await newMember.roles.add(role).catch(() => {});
      logModAction(newMember.guild, `✨ **${newMember.user.tag}** boosted and got **Exclusive** role`);
    }
  } catch (err) {
    console.error("Booster role error:", err);
  }
});

// ---------------- LOGIN ----------------
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Auto join VC 24/7 (mod-only startup)
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  const vc = guild.channels.cache.get(VC_ID);
  if (vc && vc.isVoiceBased()) joinPersistentVC(guild, vc);
});

client.login(TOKEN);

