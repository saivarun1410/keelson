package com.acme.service;

import com.acme.repository.UserRepository;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public UserResponse findById(String id) {
        return UserResponse.from(userRepository.load(id));
    }
}
