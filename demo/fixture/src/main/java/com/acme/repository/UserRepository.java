package com.acme.repository;

import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {

    public UserRecord load(String id) {
        throw new UnsupportedOperationException("demo fixture");
    }
}
