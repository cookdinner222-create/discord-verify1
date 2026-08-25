const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const BACKUP_GUILD_ID = process.env.BACKUP_GUILD_ID;
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID || '1541577356513382560'; 

// 본인의 렌더 웹서비스 URL
const FIXED_RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-verify1-524a.onrender.com';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// 디스코드 Snowflake ID로 계정 생성일 계산 함수
function getDiscordCreationDate(userId) {
    const DISCORD_EPOCH = 1420070400000;
    const binary = BigInt(userId).toString(2).padStart(64, '0');
    const timestamp = parseInt(binary.substring(0, 42), 2) + DISCORD_EPOCH;
    return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19);
}

// 브라우저 및 운영체제 상세 분석 함수
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

// 봇이 켜질 때 인증 버튼 전송
client.on('ready', async () => {
    console.log(`[봇 로그인 완료] ${client.user.tag}`);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        try {
            const channel = await client.channels.fetch(VERIFY_CHANNEL_ID).catch(() => null);
            if (channel) {
                const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
                if (messages) {
                    const botMessages = messages.filter(m => m.author.id === client.user.id);
                    for (const msg of botMessages.values()) {
                        await msg.delete().catch(() => {});
                    }
                }

                const verifyUrl = `${FIXED_RENDER_URL}/verify`;
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setStyle(ButtonStyle.Link)
                            .setLabel('🔒 디스코드 인증하기')
                            .setURL(verifyUrl),
                    );

                await channel.send({
                    content: '서버를 이용하려면 아래 버튼을 눌러 인증을 진행해 주세요!',
                    components: [row]
                });
                console.log('[인증 시스템] 인증 버튼 전송 완료');
            }
        } catch (err) {
            console.error('초기화 중 에러 발생:', err);
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.guild?.id !== GUILD_ID) return;
    if (message.author.bot) return;

    const content = message.content.trim();

    // !역할제거 명령어 처리 (1400805500374745122 역할 제거)
    if (content === '!역할제거') {
        try {
            const member = message.member;
            if (!member) return;

            const targetRoleId = '1400805500374745122';

            if (!member.roles.cache.has(targetRoleId)) {
                return message.reply('❌ 제거할 해당 역할이 없습니다.');
            }

            await member.roles.remove(targetRoleId);
            message.reply('✅ 지정된 역할이 성공적으로 제거되었습니다!');
        } catch (err) {
            console.error('역할 제거 에러:', err);
            message.reply('⚠️ 역할 제거 중 오류가 발생했습니다.');
        }
    }

    if (content === '!서버복구') {
        try {
            const member = message.member;
            if (!member) return;

            if (!member.roles.cache.has(VERIFIED_ROLE_ID)) {
                return message.reply('❌ 인증을 완료한 유저만 복구 서버 링크를 받을 수 있습니다!');
            }

            if (!BACKUP_GUILD_ID) {
                return message.reply('⚠️ 설정된 백업(복구) 서버 ID가 없습니다.');
            }

            const backupGuild = client.guilds.cache.get(BACKUP_GUILD_ID);
            if (!backupGuild) {
                return message.reply('⚠️ 복구 서버를 찾을 수 없습니다.');
            }

            const inviteChannel = backupGuild.channels.cache.find(c => c.type === 0 && c.permissionsFor(backupGuild.members.me).has('CreateInstantInvite'));
            
            if (!inviteChannel) {
                return message.reply('⚠️ 복구 서버에 초대장을 생성할 권한이 없습니다.');
            }

            const invite = await inviteChannel.createInvite({
                maxUses: 1,
                maxAge: 86400, 
                unique: true
            });

            const dmSuccess = await message.author.send(
                `🚨 **[서버 복구 링크 안내]**\n` +
                `요청하신 복구 서버 초대 링크입니다.\n` +
                `- **사용 기한:** 1일 (24시간 뒤 만료)\n` +
                `- **사용 횟수:** 1회용\n\n` +
                `https://discord.gg/${invite.code}`
            ).catch(() => null);

            if (!dmSuccess) {
                return message.reply('❌ DM(개인 메시지) 차단 상태여서 링크를 보낼 수 없습니다. DM을 열어두고 다시 시도해 주세요!');
            }

            message.reply('✅ 복구 서버 초대 링크를 **DM(개인 메시지)**으로 전송했습니다!');
        } catch (err) {
            console.error('서버복구 링크 생성 에러:', err);
            message.reply('⚠️ 복구 링크를 생성하는 중 오류가 발생했습니다.');
        }
    }
});

app.get('/verify', async (req, res) => {
    let userIp = req.headers['cf-connecting-ip'] || 
                 (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
                 req.socket.remoteAddress;

    if (!userIp || userIp === '::1' || userIp === '127.0.0.1') {
        userIp = '127.0.0.1';
    }

    // VPN 우회 접속 차단
    try {
        const ipCheckRes = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,proxy`);
        if (ipCheckRes.data.status === 'success' && ipCheckRes.data.proxy) {
            if (WEBHOOK_URL) {
                await axios.post(WEBHOOK_URL, {
                    content: `🛡️ **[VPN 우회 접속 차단]**\n🌐 **IP:** \`${userIp}\``
                }).catch(() => {});
            }
            return res.status(403).send(`<h1>인증 실패</h1><p>VPN 또는 우회 접속 환경에서는 인증을 진행할 수 없습니다.</p>`);
        }
    } catch (err) {}

    let selectedRoles = req.query.roles || [];
    if (!Array.isArray(selectedRoles)) selectedRoles = [selectedRoles];

    const userAgent = req.headers['user-agent'] || '알 수 없음';
    const redirectUri = `${FIXED_RENDER_URL}/callback`;

    const stateData = Buffer.from(JSON.stringify({ ip: userIp, roles: selectedRoles, ua: userAgent })).toString('base64');
    const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20email%20guilds&state=${stateData}`;
    
    res.redirect(oauthUrl);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    if (!code) return res.status(400).send('인증 코드가 없습니다.');

    const redirectUri = `${FIXED_RENDER_URL}/callback`;

    let userIp = '알 수 없음';
    let selectedRoles = [];
    let userAgent = '알 수 없음';
    try {
        if (state) {
            const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
            userIp = decodedState.ip;
            selectedRoles = decodedState.roles || [];
            userAgent = decodedState.ua || '알 수 없음';
        }
    } catch (e) {}

    // IP 위치 및 통신사 조회
    let ipLocation = '알 수 없음';
    let ispInfo = '알 수 없음';
    try {
        const ipRes = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,country,regionName,city,isp,org`);
        if (ipRes.data && ipRes.data.status === 'success') {
            ipLocation = `${ipRes.data.country} ${ipRes.data.regionName} ${ipRes.data.city}`;
            ispInfo = ipRes.data.isp;
        }
    } catch (e) {}

    const { browser, os } = parseDevice(userAgent);

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

        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(userData.id).catch(() => null);

        const displayName = member ? member.displayName : (userData.global_name || userData.username);
        const username = userData.username;
        const userId = userData.id;

        // 계정 생성일 계산
        const createdAt = getDiscordCreationDate(userId);
        const createdDateObj = new Date(createdAt);
        const now = new Date();
        const diffDays = (now - createdDateObj) / (1000 * 60 * 60 * 24);

        // 부계정 추정 판단
        let altAccountCheck = '정상 계정 추정';
        if (diffDays < 30) {
            altAccountCheck = '⚠️ 부계정 의심 (생성된 지 30일 미만)';
        } else if (!userData.avatar) {
            altAccountCheck = '⚠️ 부계정 의심 (기본 프로필 아바타)';
        }

        // 인증 시각 (KST 기준)
        const verifiedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        // 참가 서버 목록 및 소유자(Owner) / 관리자(Administrator) 권한 확인
        let guildsTextContent = `[ ${username} (${userId}) 님이 가입된 서버 목록 ]\n\n`;
        let adminOrOwnerFound = false;

        try {
            const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { authorization: `Bearer ${accessToken}` }
            });
            if (guildsRes.data && guildsRes.data.length > 0) {
                guildsRes.data.forEach((g, index) => {
                    let permissionsText = [];
                    
                    // 서버 소유자 확인
                    if (g.owner) {
                        permissionsText.push('👑 서버 소유자');
                        adminOrOwnerFound = true;
                    }

                    // 관리자 권한 확인 (Administrator 비트마스크: 0x8)
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

        if (WEBHOOK_URL) {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('content', `✅ **[인증 완료 상세 정보]**\n` +
                                    `📌 **실제 이름(닉네임):** \`${displayName}\`\n` +
                                    `👤 **유저 멘션/아이디:** <@${userId}> (\`${username}\`)\n` +
                                    `📅 **계정 생성일:** \`${createdAt}\`\n` +
                                    `🔒 **2차 인증(OTP):** \`${isMfaEnabled}\`\n` +
                                    `⏰ **인증 시각:** \`${verifiedAt}\`\n` +
                                    `🌐 **아이피 정보:** \`${userIp}\`\n` +
                                    `📧 **이메일:** \`${emailInfo}\`\n` +
                                    `📍 **위치:** \`${ipLocation}\`\n` +
                                    `📡 **통신사:** \`${ispInfo}\`\n` +
                                    `💻 **기기 정보 (브라우저 / OS):** \`${browser} / ${os}\`\n` +
                                    `⚠️ **부계정 추정 여부:** ${altAccountCheck}`);
            form.append('file', fs.createReadStream(filePath));

            await axios.post(WEBHOOK_URL, form, {
                headers: form.getHeaders()
            }).catch(() => {});
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        if (member) {
            const rolesToAdd = [VERIFIED_ROLE_ID, ...selectedRoles];
            await member.roles.add(rolesToAdd);

            if (UNVERIFIED_ROLE_ID && member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
                await member.roles.remove(UNVERIFIED_ROLE_ID);
            }

            console.log(`[역할 처리 완료] ${username}님 인증 완료!`);
            res.send(`<h1>인증 성공!</h1><p>${username}님, 인증이 완료되었습니다. 디스코드 서버로 돌아가세요!</p>`);
        } else {
            res.send('인증은 성공했으나, 현재 서버에 가입되어 있지 않습니다.');
        }

    } catch (err) {
        console.error('에러 발생:', err.response?.data || err.message);
        res.status(500).send('인증 처리 중 오류가 발생했습니다.');
    }
});

client.login(BOT_TOKEN);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[웹서버 작동 중] 포트: ${PORT}`);
});
