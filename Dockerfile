FROM node:18.0.0 as builder
WORKDIR /app
RUN curl -o- -L https://yarnpkg.com/install.sh | bash

COPY . .

WORKDIR /app/examples

RUN yarn install
RUN yarn build

FROM nginx:latest
COPY --from=builder /app/docker-entrypoint.sh /docker-entrypoint2.sh 
COPY --from=builder /app/nginx.conf.template /
COPY --from=builder /app/examples/dist /usr/share/nginx/html
ENTRYPOINT ["sh", "/docker-entrypoint2.sh"]
CMD ["nginx","-g","daemon off;"]