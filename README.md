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

<code>POST</code> <code><b>/v1/api/register</b></code> <code>register</code>

- POST /v1/api/login
- GET /v1/api/resource //test authentication
- POST /v1/api/profile //xem profile
- PATCH /v1/api/profile/update //update thong tin
- POST /v1/api/profile/upload //upload avatar
- POST /v1/api/change-pwd //change password
