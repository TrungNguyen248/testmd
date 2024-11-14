#### Clone repo

##

```
    git clone https://github.com/TrungNguyen248/loginsystem.git

    cd /login_system
    npm install
```

#### Cấu hình env

```
#config server port
PORT=5000 //your_port

#config mongodb
MONGO_HOST=your_host #localhost
MONGO_PORT=27017
MONGO_DATABASE=your_database
MONGO_USERNAME=
MONGO_PASSWORD=
```

#### Run project

```
    npm run dev
```

- <code>POST</code> <code><b>/v1/api/register</b></code> <code>register</code>
- <code>POST</code> <code><b>/v1/api/login</b></code> <code>login</code>
- <code>GET</code> <code><b>/v1/api/resource</b></code> <code>test authentication</code>
- <code>POST</code> <code><b>/v1/api/profile</b></code> <code>get profile</code>
- <code>PATCH</code> <code><b>/v1/api/profile/update</b></code> <code>update profile</code>
- <code>POST</code> <code><b>/v1/api/profile/upload</b></code> <code>upload avatar</code>
- <code>POST</code> <code><b>/v1/api/profile/change-pwd</b></code> <code>change password</code>
