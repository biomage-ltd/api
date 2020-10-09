# pull official base image
FROM node:13.12.0-alpine

# set working directory
WORKDIR /app

# add `/app/node_modules/.bin` to $PATH
ENV PATH /app/node_modules/.bin:$PATH

# install app dependencies
COPY package.json package-lock.json ./

RUN npm ci --only=production

# Install Helm
RUN apk add --no-cache bash curl openssl
RUN curl https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash

# add app
COPY . ./

# run
EXPOSE 3000
CMD ["npm", "start"]